# ADR-002: Telegram Gateway v1 Design

- Status: accepted
- Date: 2026-10-19

## Context

The Telegram gateway is the first reference application service in HOME_SERVER.
Its v1 contract needs explicit behavior for webhook acknowledgement, duplicate
updates, authorization, idempotency, delivery retries, retention, and
operational observability before implementation begins.

## Decisions

- Accept webhook events only after validation, authorization, duplicate
  protection, and PostgreSQL persistence. Return HTTP 200 for accepted and
  duplicate updates; return generic 4xx responses for invalid secret tokens,
  malformed updates, and unauthorized requests.
- Persist normalized text-message events, not raw update payloads. Ignore
  well-formed unsupported update types with HTTP 200. Keep chat, sender, and
  enabled-command allowlists in PostgreSQL; require both chat and sender to be
  allowlisted and deny by default.
- Support plain text outbound messages in v1. The same idempotency key and
  content returns the existing delivery; reusing a key with different content
  returns HTTP 409.
- Apply a 10-second timeout and at most five total Telegram API attempts.
  Retry transient failures with exponential backoff starting at one second and
  capped at 30 seconds. Honor Telegram `retry_after` up to five minutes; longer
  requested delays become terminal failures.
- Retain inbound events for 90 days from receipt and terminal delivery records
  for 90 days after completion. Do not expire non-terminal deliveries.
- Use persisted PostgreSQL delivery state and structured, redacted logs for v1
  observability; a Prometheus endpoint is not required.

## Consequences

- Duplicate webhook delivery and outbound retries do not create duplicate
  accepted events or deliveries.
- Telegram may retry rejected webhook requests because they receive 4xx
  responses; repeated rejection must be observable without logging secrets or
  message text.
- The cleanup task and its schedule must be documented in the service runbook.
- The contract and this ADR must be updated together if these v1 semantics
  change.