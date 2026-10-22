# Telegram Gateway Memory

Status: planned

The Telegram gateway is the first reference service for HOME_SERVER. It
receives and normalizes Telegram updates, authorizes users and groups, delivers
messages for other services, and persists delivery state in PostgreSQL.

The service must expose a documented adapter contract so future services such
as the water-quality IoT application do not depend on gateway internals.

The current draft contract is
`docs/contracts/telegram-gateway-v1.md`. It defines webhook verification,
deny-by-default authorization, normalized events, a versioned internal message
adapter, PostgreSQL-backed delivery state, bounded retries, and health/readiness
endpoints.

## Verified network boundary

The internal message adapter is reachable from trusted LAN clients such as the
ESP8266 through the Docker host's LAN address and port 3000. This exposure is
required for ESP-to-gateway communication. The port must remain LAN-only and
must not be published through Internet ingress, router port forwarding, or
public reverse proxy. Device authentication (API key or mTLS) remains required
before treating the LAN as a sufficient production boundary. The current
implementation uses `INTERNAL_API_KEY` with a Bearer authorization header.
