import crypto from "node:crypto";
import type { Pool } from "pg";
import type {
  EnqueueDeliveryResult,
  GatewayRepository,
  OutboundMessageRequest,
} from "./app.js";
import type { DeliveryRepository, PendingDelivery } from "./delivery-worker.js";
import type { TelegramEvent } from "./telegram-update.js";

export class PostgresGatewayRepository
  implements GatewayRepository, DeliveryRepository
{
  constructor(private readonly pool: Pool) {}

  async checkReady(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async hasEvent(updateId: number): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM telegram_events WHERE update_id = $1) AS exists",
      [updateId],
    );
    return result.rows[0]?.exists === true;
  }

  async isAuthorized(
    chatId: string,
    senderId: string,
    command: string | null,
  ): Promise<boolean> {
    const result = await this.pool.query<{ allowed: boolean }>(
      `
        SELECT
          EXISTS (
            SELECT 1 FROM telegram_allowed_chats
            WHERE chat_id = $1 AND enabled
          )
          AND EXISTS (
            SELECT 1 FROM telegram_allowed_senders
            WHERE chat_id = $1 AND sender_id = $2 AND enabled
          )
          AND (
            $3::text IS NULL OR EXISTS (
              SELECT 1 FROM telegram_enabled_commands
              WHERE command = $3 AND enabled
            )
          ) AS allowed
      `,
      [chatId, senderId, command],
    );
    return result.rows[0]?.allowed === true;
  }

  async saveEvent(event: TelegramEvent): Promise<"inserted" | "duplicate"> {
    if (!event.sender.id) {
      throw new Error("Cannot persist an event without a sender ID");
    }

    const result = await this.pool.query(
      `
        INSERT INTO telegram_events (
          event_id, update_id, received_at, chat_id, chat_type,
          sender_id, username, kind, text
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (update_id) DO NOTHING
        RETURNING update_id
      `,
      [
        event.eventId,
        event.updateId,
        event.receivedAt,
        event.chat.id,
        event.chat.type,
        event.sender.id,
        event.sender.username ?? null,
        event.kind,
        event.text,
      ],
    );
    return result.rowCount === 0 ? "duplicate" : "inserted";
  }

  async enqueueDelivery(
    request: OutboundMessageRequest,
  ): Promise<EnqueueDeliveryResult> {
    const deliveryId = `delivery-${crypto.randomUUID()}`;
    const inserted = await this.pool.query<{ delivery_id: string }>(
      `
        INSERT INTO message_deliveries (
          delivery_id, idempotency_key, chat_id, text, parse_mode, status
        ) VALUES ($1, $2, $3, $4, $5, 'queued')
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING delivery_id
      `,
      [
        deliveryId,
        request.idempotencyKey,
        request.chatId,
        request.text,
        request.parseMode,
      ],
    );
    if (inserted.rowCount !== 0) {
      return { status: "queued", deliveryId };
    }

    const existing = await this.pool.query<{
      delivery_id: string;
      status: "queued" | "sending" | "retry_wait" | "delivered" | "failed";
      chat_id: string;
      text: string;
      parse_mode: "plain";
    }>(
      `
        SELECT delivery_id, status, chat_id, text, parse_mode
        FROM message_deliveries
        WHERE idempotency_key = $1
      `,
      [request.idempotencyKey],
    );
    const current = existing.rows[0];
    if (!current) {
      throw new Error("Delivery disappeared after idempotency conflict");
    }

    const sameContent =
      current.chat_id === request.chatId &&
      current.text === request.text &&
      current.parse_mode === request.parseMode;
    return sameContent
      ? {
          status: "existing",
          deliveryId: current.delivery_id,
          deliveryStatus: current.status,
        }
      : { status: "conflict" };
  }

  async claimNextDelivery(now: Date): Promise<PendingDelivery | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PendingDelivery>(
        `
          UPDATE message_deliveries
          SET status = 'sending',
              attempt_count = attempt_count + 1,
              updated_at = now()
          WHERE delivery_id = (
            SELECT delivery_id
            FROM message_deliveries
            WHERE (
              status = 'queued'
              OR (status = 'retry_wait' AND next_attempt_at <= $1)
            )
            AND attempt_count < 5
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          RETURNING
            delivery_id AS "deliveryId",
            chat_id AS "chatId",
            text,
            attempt_count AS "attemptCount"
        `,
        [now],
      );
      await client.query("COMMIT");
      return result.rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markDelivered(deliveryId: string, completedAt: Date): Promise<void> {
    await this.pool.query(
      `
        UPDATE message_deliveries
        SET status = 'delivered', completed_at = $2, updated_at = now()
        WHERE delivery_id = $1 AND status = 'sending'
      `,
      [deliveryId, completedAt],
    );
  }

  async markRetry(
    deliveryId: string,
    nextAttemptAt: Date,
    errorCode: string,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE message_deliveries
        SET status = 'retry_wait',
            next_attempt_at = $2,
            last_error_code = $3,
            updated_at = now()
        WHERE delivery_id = $1 AND status = 'sending'
      `,
      [deliveryId, nextAttemptAt, errorCode],
    );
  }

  async markFailed(
    deliveryId: string,
    completedAt: Date,
    errorCode: string,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE message_deliveries
        SET status = 'failed', completed_at = $2, last_error_code = $3,
            updated_at = now()
        WHERE delivery_id = $1 AND status = 'sending'
      `,
      [deliveryId, completedAt, errorCode],
    );
  }
}
