import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { normalizeTelegramUpdate } from "./telegram-update.js";
import type { TelegramEvent } from "./telegram-update.js";

export interface GatewayRepository {
  checkReady: () => Promise<void>;
  hasEvent: (updateId: number) => Promise<boolean>;
  isAuthorized: (
    chatId: string,
    senderId: string,
    command: string | null,
  ) => Promise<boolean>;
  saveEvent: (event: TelegramEvent) => Promise<"inserted" | "duplicate">;
  enqueueDelivery: (
    request: OutboundMessageRequest,
  ) => Promise<EnqueueDeliveryResult>;
}

export interface OutboundMessageRequest {
  idempotencyKey: string;
  chatId: string;
  text: string;
  parseMode: "plain";
}

export type EnqueueDeliveryResult =
  | { status: "queued"; deliveryId: string }
  | { status: "existing"; deliveryId: string; deliveryStatus: DeliveryStatus }
  | { status: "conflict" };

export type DeliveryStatus =
  "queued" | "sending" | "retry_wait" | "delivered" | "failed";

function matchesSecret(
  provided: string | undefined,
  expected: string,
): boolean {
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function errorBody(requestId: string, code: string, message: string) {
  return { error: { code, message, requestId } };
}

function parseOutboundMessageRequest(
  value: unknown,
): OutboundMessageRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const request = value as Record<string, unknown>;
  const { idempotencyKey, chatId, text, parseMode = "plain" } = request;
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim() === "" ||
    typeof chatId !== "string" ||
    chatId.trim() === "" ||
    typeof text !== "string" ||
    text.trim() === "" ||
    parseMode !== "plain"
  ) {
    return null;
  }

  return {
    idempotencyKey,
    chatId,
    text,
    parseMode: "plain",
  };
}

export function buildApp(repository: GatewayRepository, webhookSecret: string) {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: {
      redact: [
        "req.headers.authorization",
        "req.headers.x-telegram-bot-api-secret-token",
      ],
    },
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (statusCode >= 500) {
      request.log.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Request failed",
      );
    }

    return reply
      .code(statusCode)
      .send(
        errorBody(
          request.id,
          statusCode < 500 ? "invalid_request" : "internal_error",
          statusCode < 500 ? "Request is invalid" : "Internal server error",
        ),
      );
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.split("?", 1)[0] !== "/telegram/webhook") {
      return;
    }

    const provided = request.headers["x-telegram-bot-api-secret-token"];
    if (
      typeof provided !== "string" ||
      !matchesSecret(provided, webhookSecret)
    ) {
      return reply
        .code(401)
        .send(errorBody(request.id, "unauthorized", "Request is unauthorized"));
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (_request, reply) => {
    try {
      await repository.checkReady();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.post("/internal/messages/v1", async (request, reply) => {
    const message = parseOutboundMessageRequest(request.body);
    if (!message) {
      return reply
        .code(400)
        .send(errorBody(request.id, "invalid_request", "Request is invalid"));
    }

    const result = await repository.enqueueDelivery(message);
    if (result.status === "conflict") {
      return reply
        .code(409)
        .send(
          errorBody(
            request.id,
            "idempotency_conflict",
            "Idempotency key was already used with different content",
          ),
        );
    }
    if (result.status === "existing") {
      return {
        deliveryId: result.deliveryId,
        status: result.deliveryStatus,
      };
    }

    return reply.code(202).send({
      deliveryId: result.deliveryId,
      status: result.status,
    });
  });

  app.post("/telegram/webhook", async (request, reply) => {
    const normalized = normalizeTelegramUpdate(request.body);
    if (normalized.kind === "invalid") {
      return reply
        .code(400)
        .send(errorBody(request.id, "invalid_request", "Request is invalid"));
    }
    if (normalized.kind === "ignored") {
      return { status: "ignored" };
    }

    if (await repository.hasEvent(normalized.event.updateId)) {
      return { status: "duplicate" };
    }

    if (!normalized.event.sender.id) {
      return reply
        .code(403)
        .send(errorBody(request.id, "forbidden", "Request is not authorized"));
    }

    const allowed = await repository.isAuthorized(
      normalized.event.chat.id,
      normalized.event.sender.id,
      normalized.command,
    );
    if (!allowed) {
      return reply
        .code(403)
        .send(errorBody(request.id, "forbidden", "Request is not authorized"));
    }

    const result = await repository.saveEvent(normalized.event);
    if (result === "duplicate") {
      return { status: "duplicate" };
    }

    return { status: "accepted", eventId: normalized.event.eventId };
  });

  return app;
}
