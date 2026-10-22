# Telegram Gateway

TypeScript/Node.js service for the HOME_SERVER Telegram gateway contract.

## Local development

1. Install Node.js 22 and npm.
2. Run `npm ci` in this directory.
3. Copy `.env.example` to `.env` and replace the Telegram placeholders before
   using Telegram API features.
4. Run `docker compose up --build`.

The Compose database is local to this project and is not published to the host.
The application is exposed only on `127.0.0.1:3000`.

Available checks: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm test`, and `npm run test:integration`.

## Initial endpoints

- `GET /health` confirms that the process is running.
- `GET /ready` checks PostgreSQL connectivity without exposing database errors.
- `POST /internal/messages/v1` validates and queues plain-text deliveries with
  idempotency protection.

The webhook accepts authorized text messages and ignores unsupported update
types. A background worker claims queued deliveries, sends plain text through
the Telegram Bot API, and persists delivered, retry-wait, or failed status.
See the accepted contract at `../../docs/contracts/telegram-gateway-v1.md`.
