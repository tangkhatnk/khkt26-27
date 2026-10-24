import { afterAll, beforeAll, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerWebAssets } from "../src/webAssets.js";

let directory: string;
const app = Fastify();
app.addHook("onRequest", async (_request, reply) => {
  reply.header("Content-Security-Policy", "default-src 'none'");
});
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "viendu-web-test-"));
  const web = join(directory, "dist");
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(web, "index.html"), "<html>Viễn Du</html>");
  await writeFile(join(web, "assets", "app-abc.js"), "console.log('app')");
  await writeFile(join(web, "pdf.worker.min.mjs"), "export const worker = true;");
  await writeFile(join(directory, "private.txt"), "private data");
  await symlink(join(directory, "private.txt"), join(web, "escape.txt"));
  app.get("/health", () => ({ status: "healthy" }));
  app.post("/api/v1/auth/register", () => ({ route: "registration" }));
  await registerWebAssets(app, web);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("serves the web shell and hashed assets on the API server", async () => {
  const root = await app.inject("/");
  expect(root.statusCode).toBe(200);
  expect(root.headers["content-type"]).toContain("text/html");
  expect(root.headers["cache-control"]).toContain("no-cache");
  expect(root.body).toContain("Viễn Du");
  expect(root.headers["content-security-policy"]).toContain("script-src 'self'");
  expect(root.headers["content-security-policy"]).toContain("connect-src 'self'");
  const asset = await app.inject("/assets/app-abc.js");
  expect(asset.headers["content-type"]).toContain("javascript");
  expect(asset.headers["cache-control"]).toContain("immutable");
  expect(asset.body).toContain("console.log");
  const worker = await app.inject("/pdf.worker.min.mjs");
  expect(worker.statusCode).toBe(200);
  expect(worker.headers["content-type"]).toContain("javascript");
  expect(worker.headers["cache-control"]).toContain("no-cache");
  expect(worker.headers["content-security-policy"]).toContain("'wasm-unsafe-eval'");
});
it("keeps API and health responses distinct from the SPA fallback", async () => {
  expect((await app.inject("/health")).json()).toEqual({ status: "healthy" });
  expect((await app.inject("/health")).headers["content-security-policy"]).toBe("default-src 'none'");
  expect((await app.inject({ method: "POST", url: "/api/v1/auth/register" })).json()).toEqual({ route: "registration" });
  const missingApi = await app.inject({ url: "/api/v1/missing", headers: { accept: "text/html" } });
  expect(missingApi.statusCode).toBe(404);
  expect(missingApi.headers["content-type"]).not.toContain("text/html");
  const route = await app.inject({ url: "/study/biology", headers: { accept: "text/html" } });
  expect(route.statusCode).toBe(200);
  expect(route.body).toContain("Viễn Du");
  expect((await app.inject({ url: "/assets/missing.js", headers: { accept: "text/html" } })).statusCode).toBe(404);
});
it("does not expose hidden files, traversal, symlinks outside dist, or malformed paths", async () => {
  for (const path of ["/.env", "/%2e%2e%2fprivate.txt", "/escape.txt", "/%00.txt", "/bad%zz"]) {
    const response = await app.inject(path);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain("private data");
  }
});
it("fails startup when the built frontend is absent", async () => {
  const empty = Fastify();
  await expect(registerWebAssets(empty, join(directory, "missing"))).rejects.toThrow();
  await empty.close();
});
