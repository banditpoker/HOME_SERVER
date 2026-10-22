import { describe, expect, it, vi } from "vitest";
import {
  DeliveryWorker,
  TelegramApiError,
  type DeliveryRepository,
  type PendingDelivery,
  type TelegramSender,
} from "../src/delivery-worker.js";

function delivery(attemptCount = 1): PendingDelivery {
  return {
    deliveryId: "delivery-1",
    chatId: "-100123",
    text: "hello",
    attemptCount,
  };
}

function repository(current: PendingDelivery | null = delivery()) {
  return {
    claimNextDelivery: vi.fn(async () => current),
    markDelivered: vi.fn(async () => undefined),
    markRetry: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  } satisfies DeliveryRepository;
}

describe("DeliveryWorker", () => {
  it("delivers a claimed message", async () => {
    const repo = repository();
    const sender = {
      sendMessage: vi.fn(async () => undefined),
    } satisfies TelegramSender;
    const worker = new DeliveryWorker(repo, sender);

    await expect(
      worker.processNext(new Date("2026-10-22T00:00:00Z")),
    ).resolves.toBe(true);

    expect(sender.sendMessage).toHaveBeenCalledWith(
      "-100123",
      "hello",
      expect.any(AbortSignal),
    );
    expect(repo.markDelivered).toHaveBeenCalledWith(
      "delivery-1",
      expect.any(Date),
    );
  });

  it("schedules transient failures with exponential backoff", async () => {
    const repo = repository();
    const sender = {
      sendMessage: vi.fn(async () => {
        throw new TelegramApiError("telegram_http_500", true);
      }),
    } satisfies TelegramSender;
    const worker = new DeliveryWorker(repo, sender);
    const now = new Date("2026-10-22T00:00:00Z");

    await worker.processNext(now);

    expect(repo.markRetry).toHaveBeenCalledWith(
      "delivery-1",
      new Date("2026-10-22T00:00:01Z"),
      "telegram_http_500",
    );
  });

  it("fails after the fifth attempt", async () => {
    const repo = repository(delivery(5));
    const sender = {
      sendMessage: vi.fn(async () => {
        throw new TelegramApiError("telegram_http_500", true);
      }),
    } satisfies TelegramSender;
    const worker = new DeliveryWorker(repo, sender);

    await worker.processNext();

    expect(repo.markFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.any(Date),
      "telegram_http_500",
    );
    expect(repo.markRetry).not.toHaveBeenCalled();
  });

  it("fails when Telegram asks for a retry longer than five minutes", async () => {
    const repo = repository();
    const sender = {
      sendMessage: vi.fn(async () => {
        throw new TelegramApiError("telegram_http_429", true, 301);
      }),
    } satisfies TelegramSender;
    const worker = new DeliveryWorker(repo, sender);

    await worker.processNext();

    expect(repo.markFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.any(Date),
      "telegram_http_429",
    );
  });
});
