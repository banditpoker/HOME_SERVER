export interface AppConfig {
  port: number;
  databaseUrl: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  internalApiKey: string;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const databaseUrl = environment.DATABASE_URL;
  const telegramBotToken = environment.TELEGRAM_BOT_TOKEN;
  const telegramWebhookSecret = environment.TELEGRAM_WEBHOOK_SECRET;
  const internalApiKey = environment.INTERNAL_API_KEY;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  if (!telegramWebhookSecret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is required");
  }
  if (!internalApiKey) {
    throw new Error("INTERNAL_API_KEY is required");
  }

  let databaseProtocol: string;
  try {
    databaseProtocol = new URL(databaseUrl).protocol;
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (databaseProtocol !== "postgres:" && databaseProtocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol");
  }

  const portValue = environment.PORT ?? "3000";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    port,
    databaseUrl,
    telegramBotToken,
    telegramWebhookSecret,
    internalApiKey,
  };
}
