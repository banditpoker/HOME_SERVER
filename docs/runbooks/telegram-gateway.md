# Telegram Gateway Runbook

Status: draft

## Operational checks

- Check `/health` and `/ready`.
- Inspect structured delivery and webhook logs.
- Verify PostgreSQL connectivity.
- Review retry and outbox state before restarting the service.

## Delivery outbox

The gateway worker polls PostgreSQL once per second, claims one queued or due
`retry_wait` delivery using `FOR UPDATE SKIP LOCKED`, and sends it through the
Telegram Bot API. Each request has a 10-second timeout and a maximum of five
attempts. Transient failures use exponential backoff (1, 2, 4, 8, 16 seconds,
capped at 30 seconds); Telegram `retry_after` values up to five minutes take
precedence. Longer rate-limit delays and permanent failures become `failed`.

Delivery state is persisted in `message_deliveries`. Before restarting, check
for `sending` rows left by an interrupted process; these require operational
inspection because v1 does not automatically reclaim stale sends.

## Deployment and recovery

Run `docker compose up --build` from `apps/telegram-gateway/`. The database
volume is `telegram-gateway-db`; back it up using the PostgreSQL platform's
standard backup procedure before destructive maintenance. Migrations run at
application startup under a PostgreSQL advisory lock. A failed migration
rolls back its transaction; resolve the migration error before restarting.
