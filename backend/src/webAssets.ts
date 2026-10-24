import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".wasm": "application/wasm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

// The API's restrictive CSP must not block the web shell or its PDF worker.
const webContentSecurityPolicy = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'self' https: wss:",
  "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'",
  "frame-ancestors 'none'", "form-action 'self'",
].join("; ");

/** Serve the built web app from the same origin as the authenticated API. */
export async function registerWebAssets(app: FastifyInstance, directory: string) {
  const root = await realpath(directory);
  const inside = (path: string) => path.startsWith(root + sep);
  const index = await realpath(resolve(root, "index.html"));
  if (!inside(index) || !(await stat(index)).isFile())
    throw new Error("WEB_DIST_DIR must contain the built index.html");

  const deliver = async (request: FastifyRequest, reply: FastifyReply) => {
    let path: string;
    try { path = decodeURIComponent((request.raw.url ?? "/").split("?", 1)[0]); }
    catch { return reply.code(400).send({ error: "Invalid URL path" }); }
    if (!path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
        path.split("/").some(part => part.startsWith("."))) return reply.callNotFound();
    if (/^\/(?:api|health|metrics|ws|files)(?:\/|$)/.test(path)) return reply.callNotFound();

    let file: string;
    const wanted = path === "/" ? index : resolve(root, "." + path);
    try {
      file = await realpath(wanted);
      if (!inside(file) || !(await stat(file)).isFile()) return reply.callNotFound();
    } catch {
      // Missing API paths and missing assets must never receive the HTML shell.
      if (extname(path) || path.startsWith("/assets/") || !request.headers.accept?.includes("text/html"))
        return reply.callNotFound();
      file = index;
    }
    const immutable = path.startsWith("/assets/") && file !== index;
    return reply.header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", webContentSecurityPolicy)
      .header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache")
      .type(contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream")
      .send(createReadStream(file));
  };
  app.get("/", deliver);
  app.get("/*", deliver);
}
