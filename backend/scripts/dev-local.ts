import "../src/processErrors.js";
import "dotenv/config";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
async function start() {
  try {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:15433/postgres?connection_limit=1&sslmode=disable";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.STORAGE_DRIVER = "local";
    await mkdir(".local-data", { recursive: true });
    // Keep the local secret so account credentials survive a backend restart.
    try {
      process.env.JWT_SECRET = await readFile(".local-data/jwt-secret", "utf8");
    } catch {
      const { writeFile } = await import("node:fs/promises");
      process.env.JWT_SECRET = randomBytes(32).toString("hex");
      await writeFile(".local-data/jwt-secret", process.env.JWT_SECRET, {
        mode: 0o600,
      });
    }
    console.log("1. Initializing local DB (PGlite)...");
    const pg = await PGlite.create(".local-data/database");
    await pg.exec(
      `CREATE SCHEMA IF NOT EXISTS local_runtime;
      DO $$ BEGIN
        IF to_regclass('public.local_migrations') IS NOT NULL
           AND to_regclass('local_runtime.local_migrations') IS NULL THEN
          ALTER TABLE public.local_migrations SET SCHEMA local_runtime;
        END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS local_runtime.local_migrations (name TEXT PRIMARY KEY)`,
    );
    const migrations = (await readdir("prisma/migrations", { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^\d+_/.test(entry.name))
      .map(entry => entry.name).sort();
    for (const migration of migrations) {
    const applied = await pg.query(
      "SELECT name FROM local_runtime.local_migrations WHERE name=$1",
      [migration],
    );
    if (!applied.rows.length) {
      await pg.exec(
        await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"),
      );
      await pg.query("INSERT INTO local_runtime.local_migrations(name) VALUES ($1)", [migration]);
    }
    }
    const socket = new PGLiteSocketServer({
      db: pg,
      host: "127.0.0.1",
      port: 15433,
      maxConnections: 10,
    });
    console.log("1.1. Starting local DB socket on 127.0.0.1:15433...");
    await socket.start();
    const closeDatabase = async () => {
      await socket.stop();
      // pglite-socket schedules detach callbacks after socket close.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await pg.close();
    };
    if (process.argv.includes("--db-only")) {
      console.log("PGlite database is running on 127.0.0.1:15433 (schema sync mode)");
      for (const signal of ["SIGINT", "SIGTERM"])
        process.on(signal, () => {
          void closeDatabase()
            .then(() => process.exit(0))
            .catch((error: unknown) => {
              console.error("Local DB shutdown failed:", error);
              process.exit(1);
            });
        });
      return;
    }
    console.log("1.2. Seeding local DB...");
    await import("../prisma/seed.js");
    const db = new PrismaClient();
    const redis = new RedisMock();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp({ db, redis: redis as unknown as Redis, onStartupStep: console.log });
    console.log(`3. Starting Fastify server on 0.0.0.0:${process.env.PORT ?? 3000}...`);
    await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });
    console.log(`Server is running on port ${process.env.PORT ?? 3000}`);
    console.log(
      "Backend local: PostgreSQL PGlite + Redis giả lập + tài liệu lưu trên máy. Chỉ dùng phát triển.",
    );
    const stop = async () => {
      await app.close();
      await db.$disconnect();
      redis.disconnect();
      await closeDatabase();
      process.exit(0);
    };
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        void stop().catch((error: unknown) => {
          console.error("Local backend shutdown failed:", error);
          process.exit(1);
        });
      });
  } catch (err) {
    console.error("🔥 FATAL ERROR ON LOCAL STARTUP:", err);
    process.exit(1);
  }
}

await start();
