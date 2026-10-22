const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_SECONDS = 300;

export interface PendingDelivery {
  deliveryId: string;
  chatId: string;
  text: string;
  attemptCount: number;
}

export interface DeliveryRepository {
  claimNextDelivery: (now: Date) => Promise<PendingDelivery | null>;
  markDelivered: (deliveryId: string, completedAt: Date) => Promise<void>;
  markRetry: (
    deliveryId: string,
    nextAttemptAt: Date,
    errorCode: string,
  ) => Promise<void>;
  markFailed: (
    deliveryId: string,
    completedAt: Date,
    errorCode: string,
  ) => Promise<void>;
}

export interface TelegramSender {
  sendMessage: (
    chatId: string,
    text: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export class TelegramBotSender implements TelegramSender {
  constructor(private readonly botToken: string) {}

  async sendMessage(
    chatId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal,
        },
      );
    } catch (error) {
      throw new TelegramApiError(
        error instanceof Error ? error.name : "transport_error",
        true,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TelegramApiError(
        "invalid_telegram_response",
        response.status >= 500,
      );
    }

    if (isRecord(body) && body.ok === true) {
      return;
    }

    const retryAfterSeconds = readRetryAfter(body);
    const retryable = response.status === 429 || response.status >= 500;
    throw new TelegramApiError(
      `telegram_http_${response.status}`,
      retryable,
      retryAfterSeconds,
    );
  }
}

export class DeliveryWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly repository: DeliveryRepository,
    private readonly sender: TelegramSender,
    private readonly logger: Pick<Console, "error"> = console,
    private readonly pollIntervalMs = 1_000,
  ) {}

  async processNext(now = new Date()): Promise<boolean> {
    const delivery = await this.repository.claimNextDelivery(now);
    if (!delivery) {
      return false;
    }

    try {
      await this.sender.sendMessage(
        delivery.chatId,
        delivery.text,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      );
      await this.repository.markDelivered(delivery.deliveryId, new Date());
    } catch (error) {
      await this.handleFailure(delivery, error, now);
    }
    return true;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }
    try {
      while (this.running && (await this.processNext())) {
        // Drain deliveries already available before waiting.
      }
    } catch (error) {
      this.logger.error({ error }, "Delivery worker iteration failed");
    }
    if (this.running) {
      this.timer = setTimeout(() => void this.poll(), this.pollIntervalMs);
    }
  }

  private async handleFailure(
    delivery: PendingDelivery,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const apiError =
      error instanceof TelegramApiError
        ? error
        : new TelegramApiError("delivery_error", false);
    const retryAfter = apiError.retryAfterSeconds;
    const retryAllowed =
      apiError.retryable &&
      delivery.attemptCount < MAX_ATTEMPTS &&
      (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_SECONDS);

    if (!retryAllowed) {
      await this.repository.markFailed(
        delivery.deliveryId,
        new Date(),
        apiError.message,
      );
      return;
    }

    const delayMs =
      retryAfter === undefined
        ? Math.min(1_000 * 2 ** (delivery.attemptCount - 1), 30_000)
        : retryAfter * 1_000;
    await this.repository.markRetry(
      delivery.deliveryId,
      new Date(now.getTime() + delayMs),
      apiError.message,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRetryAfter(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.parameters)) {
    return undefined;
  }
  const retryAfter = value.parameters.retry_after;
  return typeof retryAfter === "number" &&
    Number.isInteger(retryAfter) &&
    retryAfter >= 0
    ? retryAfter
    : undefined;
}
