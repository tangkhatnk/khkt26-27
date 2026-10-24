import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [{ find: "@/", replacement: fileURLToPath(new URL("../src/", import.meta.url)) }],
  },
  test: {
    include: ["tests/adminPostgresConcurrency.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
