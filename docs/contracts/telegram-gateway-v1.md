# Telegram Gateway Contract v1

Status: accepted

This contract defines the boundary between Telegram and HOME_SERVER
application services. Internal services must use this boundary rather than
calling the Telegram Bot API directly.

## Inbound webhook

`POST /telegram/webhook`

The ingress proxy must provide HTTPS. The gateway must verify the Telegram
secret token before parsing or persisting the request. Invalid, unauthorized,
or malformed requests must not be accepted as events.

The route accepts a Telegram `Update` payload. The gateway normalizes accepted
updates into an internal event with:

```json
{
  "eventId": "telegram-update-identifier",
  "updateId": 123456,
  "receivedAt": "2026-10-19T00:00:00.000Z",
  "chat": {
    "id": "-1001234567890",
    "type": "group"
  },
  "sender": {
    "id": "123456789",
    "username": "example"
  },
  "kind": "message",
  "text": "normalized message text"
}
```

`updateId` is the Telegram update identifier and is the primary duplicate
protection key. The same update must not create multiple accepted events or
execute a command more than once.

The gateway acknowledges an accepted event with HTTP 200 only after its
normalized form has been committed to PostgreSQL. A previously accepted
`updateId` is a no-op and also receives HTTP 200. Invalid secret tokens receive
HTTP 401, malformed updates receive HTTP 400, and authorization failures
receive a generic HTTP 403 that does not reveal allowlist contents. Rejected
requests are not persisted. Persist normalized event fields only; do not retain
the raw Telegram update payload.

V1 accepts text messages with a chat and sender. Other well-formed update types,
including messages without text, are acknowledged with HTTP 200 and ignored.
Malformed JSON or malformed text-message fields receive HTTP 400.

## Authorization

Authorization is deny-by-default. A text message is allowed only when both its
chat and sender are present in enabled PostgreSQL allowlists. Missing sender
identity is denied. Commands must also be explicitly enabled in PostgreSQL.
Authorization failures must not reveal which allowlist entries exist.

## Outbound message adapter

Internal services submit:

`POST /internal/messages/v1`

Request:

```json
{
  "idempotencyKey": "iot-water-quality-alert-2026-10-19-001",
  "chatId": "-1001234567890",
  "text": "pH threshold exceeded",
  "parseMode": "plain"
}
```

Required fields are `idempotencyKey`, `chatId`, and `text`. `parseMode` is
optional and defaults to `plain`; the gateway must reject empty text and
unsupported parse modes. The initial version supports text messages only.

Successful response:

```json
{
  "deliveryId": "delivery-identifier",
  "status": "queued"
}
```

New deliveries return HTTP 202. Repeated requests for the same idempotency key
return HTTP 200 with the current persisted status. The gateway currently
persists `queued` deliveries; a worker is responsible for the later Telegram
API send and retry transitions.

The same `idempotencyKey` and same request content must return the existing
delivery rather than enqueue a duplicate. Reusing a key with different request
content returns HTTP 409 with error code `idempotency_conflict`. Delivery state
and retry attempts are persisted in PostgreSQL. Delivery statuses are `queued`,
`sending`, `retry_wait`, `delivered`, and `failed`; repeated requests return
the current persisted status.

## Errors

Errors use this shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Request is invalid",
    "requestId": "request-identifier"
  }
}
```

Messages must be safe for clients and must not contain bot tokens, database
credentials, internal stack traces, or allowlist details.

## Retry and delivery

- Each Telegram API request has a 10-second timeout and at most five total
  attempts, including the initial attempt.
- Retry delays use exponential backoff starting at one second and capped at
  30 seconds. For Telegram rate limits, honor `retry_after` up to five minutes;
  a longer requested delay becomes a terminal failure.
- Retryable failures include transport failures and Telegram rate-limit or
  transient server responses.
- Permanent failures become terminal delivery failures and remain inspectable.
- The PostgreSQL outbox must make delivery state and retry attempts
  inspectable. Structured logs include request, event, and delivery identifiers
  and status, but never bot tokens or message text. V1 does not require a
  Prometheus endpoint.
- Retain inbound events for 90 days from receipt. Retain terminal delivery
  records for 90 days after completion; do not expire non-terminal deliveries.

Expired records are removed by a bounded cleanup task. The service runbook must
document its schedule and recovery implications before the service is marked
active.

## Health and readiness

- `GET /health` reports that the process is running.
- `GET /ready` reports whether required PostgreSQL connectivity and startup
  configuration are available.
- Health responses must not expose secrets or database details.

## Versioning

The internal adapter is versioned in its path as `/v1`. Backward-incompatible
changes require a new version. Additive response fields are allowed when
clients ignore unknown fields. Contract changes require updates to this file,
the service map, tests, and an implementation summary.
