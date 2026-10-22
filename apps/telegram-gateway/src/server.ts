import { Pool } from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DeliveryWorker, TelegramBotSender } from "./delivery-worker.js";
import { PostgresGatewayRepository } from "./postgres-repository.js";

const config = loadConfig();
const database = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 2_000,
  idleTimeoutMillis: 30_000,
});
const repository = new PostgresGatewayRepository(database);
const app = buildApp(
  repository,
  config.telegramWebhookSecret,
  config.internalApiKey,
);
const deliveryWorker = new DeliveryWorker(
  repository,
  new TelegramBotSender(config.telegramBotToken),
  app.log,
);

try {
  await app.listen({ host: "0.0.0.0", port: config.port });
  deliveryWorker.start();
} catch (error) {
  app.log.error({ err: error }, "Failed to start Telegram gateway");
  await deliveryWorker.stop();
  await app.close();
  await database.end();
  process.exitCode = 1;
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Shutting down Telegram gateway");
  await deliveryWorker.stop();
  await app.close();
  await database.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
