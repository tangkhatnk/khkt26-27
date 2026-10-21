import "dotenv/config";
import { z } from "zod";
export const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(32),
    METRICS_TOKEN: z.string().min(32).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default("0.0.0.0"),
    NODE_ENV: z
      .enum(["development", "test", "staging", "production"])
      .default("development"),
    CORS_ORIGIN: z.string().default("http://localhost:8081"),
    STORAGE_DRIVER: z.enum(["s3", "local"]).default("s3"),
    LOCAL_STORAGE_DIR: z.string().default(".local-data/files"),
    PUBLIC_API_ORIGIN: z.url().default("http://localhost:3000"),
    S3_BUCKET: z.string().min(1).default("pomodoro-documents"),
    S3_REGION: z.string().default("us-east-1"),
    S3_ENDPOINT: z.url().optional(),
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
    GEMINI_FALLBACK_MODEL: z.string().trim().default("gemini-3.5-flash-lite"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    APPLE_CLIENT_ID: z.string().optional(),
  })
  .parse(process.env);

if (config.NODE_ENV === "production" && config.STORAGE_DRIVER === "local")
  throw new Error("Local storage is restricted to development");
