export interface TelegramEvent {
  eventId: string;
  updateId: number;
  receivedAt: string;
  chat: {
    id: string;
    type: string;
  };
  sender: {
    id?: string;
    username?: string;
  };
  kind: "message";
  text: string;
}

export type NormalizedUpdate =
  | { kind: "event"; event: TelegramEvent; command: string | null }
  | { kind: "ignored" }
  | { kind: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function telegramId(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : null;
}

function commandFromText(text: string): string | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

export function normalizeTelegramUpdate(
  payload: unknown,
  receivedAt = new Date().toISOString(),
): NormalizedUpdate {
  if (!isRecord(payload)) {
    return { kind: "invalid" };
  }

  const updateId = payload.update_id;
  if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) {
    return { kind: "invalid" };
  }

  const message = payload.message;
  if (message === undefined) {
    return { kind: "ignored" };
  }
  if (!isRecord(message)) {
    return { kind: "invalid" };
  }
  if (!("text" in message)) {
    return { kind: "ignored" };
  }
  if (typeof message.text !== "string") {
    return { kind: "invalid" };
  }

  const chat = message.chat;
  const sender = message.from;
  const chatId = isRecord(chat) ? telegramId(chat.id) : null;
  const senderId = isRecord(sender) ? telegramId(sender.id) : null;
  if (!isRecord(chat) || !chatId || typeof chat.type !== "string") {
    return { kind: "invalid" };
  }

  const username =
    isRecord(sender) && typeof sender.username === "string"
      ? sender.username
      : undefined;
  const normalizedSender = senderId
    ? username
      ? { id: senderId, username }
      : { id: senderId }
    : {};
  const event: TelegramEvent = {
    eventId: `telegram-update-${updateId}`,
    updateId,
    receivedAt,
    chat: { id: chatId, type: chat.type },
    sender: normalizedSender,
    kind: "message",
    text: message.text,
  };

  return { kind: "event", event, command: commandFromText(message.text) };
}
