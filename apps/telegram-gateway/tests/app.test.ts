import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { TelegramEvent } from "../src/telegram-update.js";

function createRepository(overrides: Record<string, unknown> = {}) {
  return {
    checkReady: vi.fn(async () => undefined),
    hasEvent: vi.fn(async () => false),
    isAuthorized: vi.fn(async () => true),
    saveEvent: vi.fn(async () => "inserted" as const),
    enqueueDelivery: vi.fn(async () => ({
      status: "queued" as const,
      deliveryId: "delivery-1",
    })),
    ...overrides,
  };
}

const validUpdate = {
  update_id: 123456,
  message: {
    chat: { id: -100123, type: "group" },
    from: { id: 123456789, username: "example" },
    text: "/status@home_server_bot now",
  },
};

const webhookHeaders = {
  "x-telegram-bot-api-secret-token": "expected-secret",
};

describe("Telegram webhook", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  describe("outbound message adapter", () => {
    const apps: ReturnType<typeof buildApp>[] = [];

    afterEach(async () => {
      await Promise.all(apps.splice(0).map((app) => app.close()));
    });

    it("queues a valid plain-text delivery", async () => {
      const repository = createRepository();
      const app = buildApp(repository, "expected-secret");
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/internal/messages/v1",
        payload: {
          idempotencyKey: "alert-1",
          chatId: "-100123",
          text: "pH threshold exceeded",
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        deliveryId: "delivery-1",
        status: "queued",
      });
      expect(repository.enqueueDelivery).toHaveBeenCalledWith({
        idempotencyKey: "alert-1",
        chatId: "-100123",
        text: "pH threshold exceeded",
        parseMode: "plain",
      });
    });

    it.each([
      {},
      { idempotencyKey: "alert-1", chatId: "-100123", text: "" },
      {
        idempotencyKey: "alert-1",
        chatId: "-100123",
        text: "hello",
        parseMode: "markdown",
      },
    ])("rejects invalid outbound request %#", async (payload) => {
      const repository = createRepository();
      const app = buildApp(repository, "expected-secret");
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/internal/messages/v1",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(repository.enqueueDelivery).not.toHaveBeenCalled();
    });

    it("returns 409 for an idempotency conflict", async () => {
      const repository = createRepository({
        enqueueDelivery: vi.fn(async () => ({ status: "conflict" as const })),
      });
      const app = buildApp(repository, "expected-secret");
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/internal/messages/v1",
        payload: {
          idempotencyKey: "alert-1",
          chatId: "-100123",
          text: "changed",
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("idempotency_conflict");
    });

    it("returns the current status for a repeated idempotent request", async () => {
      const repository = createRepository({
        enqueueDelivery: vi.fn(async () => ({
          status: "existing" as const,
          deliveryId: "delivery-1",
          deliveryStatus: "retry_wait" as const,
        })),
      });
      const app = buildApp(repository, "expected-secret");
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/internal/messages/v1",
        payload: {
          idempotencyKey: "alert-1",
          chatId: "-100123",
          text: "hello",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        deliveryId: "delivery-1",
        status: "retry_wait",
      });
    });
  });

  function createApp(repository = createRepository()) {
    const app = buildApp(repository, "expected-secret");
    apps.push(app);
    return { app, repository };
  }

  it("checks the secret before parsing the request body", async () => {
    const { app, repository } = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "content-type": "application/json" },
      payload: "{invalid json",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
    expect(repository.isAuthorized).not.toHaveBeenCalled();
  });

  it("returns a safe 400 for malformed JSON after validating the secret", async () => {
    const { app } = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { ...webhookHeaders, "content-type": "application/json" },
      payload: "{invalid json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: "invalid_request",
      message: "Request is invalid",
    });
  });

  it("ignores unsupported update types without persisting them", async () => {
    const { app, repository } = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: webhookHeaders,
      payload: { update_id: 77, callback_query: { id: "callback-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ignored" });
    expect(repository.isAuthorized).not.toHaveBeenCalled();
    expect(repository.saveEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed text messages", async () => {
    const { app, repository } = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: webhookHeaders,
      payload: { update_id: 78, message: { text: "hello" } },
    });

    expect(response.statusCode).toBe(400);
    expect(repository.saveEvent).not.toHaveBeenCalled();
  });

  it("does not persist events from unauthorized chats or senders", async () => {
    const repository = createRepository({
      isAuthorized: vi.fn(async () => false),
    });
    const { app } = createApp(repository);

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: webhookHeaders,
      payload: validUpdate,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("Request is not authorized");
    expect(repository.saveEvent).not.toHaveBeenCalled();
  });

  it("authorizes chat and sender before persisting normalized text", async () => {
    const { app, repository } = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: webhookHeaders,
      payload: validUpdate,
    });

    expect(response.statusCode).toBe(200);
    expect(repository.isAuthorized).toHaveBeenCalledWith(
      "-100123",
      "123456789",
      "status",
    );
    expect(repository.saveEvent).toHaveBeenCalledWith<TelegramEvent>(
      expect.objectContaining({
        updateId: 123456,
        chat: { id: "-100123", type: "group" },
        sender: { id: "123456789", username: "example" },
        text: "/status@home_server_bot now",
      }),
    );
    expect(response.json()).toMatchObject({
      status: "accepted",
      eventId: "telegram-update-123456",
    });
  });

  it("acknowledges duplicate update IDs without creating another event", async () => {
    const repository = createRepository({
      saveEvent: vi.fn(async () => "duplicate" as const),
    });
    const { app } = createApp(repository);

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: webhookHeaders,
      payload: validUpdate,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "duplicate" });
  });

  it("acknowledges a persisted update before checking changed authorization", async () => {
    const repository = createRepository({
      hasEvent: vi.fn(async () => true),
      isAuthorized: vi.fn(async () => false),
    });
    const { app } = createApp(repository);

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: webhookHeaders,
      payload: validUpdate,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "duplicate" });
    expect(repository.isAuthorized).not.toHaveBeenCalled();
    expect(repository.saveEvent).not.toHaveBeenCalled();
  });

  it("returns a safe error if persistence fails", async () => {
    const repository = createRepository({
      saveEvent: vi.fn(async () => {
        throw new Error("sensitive database details");
      }),
    });
    const { app } = createApp(repository);

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: webhookHeaders,
      payload: validUpdate,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("sensitive database details");
  });
});
