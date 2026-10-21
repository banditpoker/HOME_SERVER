import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/gateway",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
};

describe("loadConfig", () => {
  it("loads required settings and defaults the port", () => {
    expect(loadConfig(validEnvironment)).toEqual({
      port: 3000,
      databaseUrl: validEnvironment.DATABASE_URL,
      telegramBotToken: validEnvironment.TELEGRAM_BOT_TOKEN,
      telegramWebhookSecret: validEnvironment.TELEGRAM_WEBHOOK_SECRET,
    });
  });

  it.each(["DATABASE_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"])(
    "rejects a missing %s",
    (key) => {
      const environment = { ...validEnvironment };
      delete environment[key as keyof typeof environment];

      expect(() => loadConfig(environment)).toThrow(`${key} is required`);
    },
  );

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      loadConfig({ ...validEnvironment, DATABASE_URL: "https://example.test" }),
    ).toThrow("DATABASE_URL must use the PostgreSQL protocol");
  });

  it("rejects ports outside the valid range", () => {
    expect(() => loadConfig({ ...validEnvironment, PORT: "70000" })).toThrow(
      "PORT must be an integer between 1 and 65535",
    );
  });
});
