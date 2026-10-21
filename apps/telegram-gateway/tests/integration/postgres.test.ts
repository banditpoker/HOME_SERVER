import { Pool } from "pg";
import { describe, expect, it } from "vitest";

describe("PostgreSQL integration", () => {
  it("accepts a database connection and executes a query", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for integration tests");
    }

    const database = new Pool({ connectionString: databaseUrl });
    try {
      const result = await database.query<{ value: number }>(
        "SELECT 1 AS value",
      );
      expect(result.rows[0]?.value).toBe(1);
    } finally {
      await database.end();
    }
  });
});
