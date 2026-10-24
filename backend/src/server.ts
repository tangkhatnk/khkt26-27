import "./processErrors.js";
import type { buildApp } from "./app.js";

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void (app?.close() ?? Promise.resolve())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error("Backend shutdown failed:", error);
        process.exit(1);
      });
  });
async function start() {
  let stage = "0. Loading backend configuration...";
  const logStep = (step: string) => {
    stage = step;
    console.log(step);
  };
  try {
    logStep(stage);
    const { config } = await import("./config.js");
    logStep("0.1. Loading backend modules...");
    const { buildApp } = await import("./app.js");
    app = await buildApp({ onStartupStep: logStep });
    if (config.WEB_DIST_DIR) {
      logStep("2.5. Registering the built Viễn Du web app...");
      const { registerWebAssets } = await import("./webAssets.js");
      await registerWebAssets(app, config.WEB_DIST_DIR);
    }
    logStep(`3. Starting Fastify server on ${config.HOST}:${config.PORT}...`);
    const address = await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Server is running on port ${config.PORT}: ${address}`);
    if (config.HOST === "127.0.0.1" || config.HOST === "localhost")
      app.log.warn(
        "HOST đang là loopback — thiết bị thật trên LAN sẽ KHÔNG kết nối được. Đặt HOST=0.0.0.0.",
      );
  } catch (err) {
    console.error(`🔥 FATAL ERROR ON STARTUP at ${stage}`, err);
    try {
      await app?.close();
    } catch (error) {
      console.error("Backend cleanup failed:", error);
    }
    process.exit(1);
  }
}

await start();
