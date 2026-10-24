import { app, BrowserWindow, net, protocol, session } from "electron";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { resolveProtocolPath } from "./protocolPath";
import {
  buildContentSecurityPolicy,
  readConfiguredApiOrigin,
} from "./securityPolicy";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "viendu",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
let window: BrowserWindow | null = null;
const root = join(__dirname, "../web-dist");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const apiOrigin = await readConfiguredApiOrigin(root);
    protocol.handle("viendu", async (request) => {
      const url = new URL(request.url);
      if (url.host !== "app" || request.method !== "GET")
        return new Response("Forbidden", { status: 403 });
      const pathResult = resolveProtocolPath(root, url.pathname);
      if (pathResult.kind === "bad-request") {
        return new Response("Bad request", { status: 400 });
      }
      if (pathResult.kind === "forbidden")
        return new Response("Forbidden", { status: 403 });
      let file = pathResult.file;
      try {
        if (!(await stat(file)).isFile()) file = join(root, "index.html");
      } catch {
        if (extname(file)) return new Response("Not found", { status: 404 });
        file = join(root, "index.html");
      }
      const result = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(result.headers);
      // PDF/OCR workers and WebAssembly use the same sandboxed app origin.
      const extension = extname(file).toLowerCase();
      if (extension === ".mjs" || extension === ".js")
        headers.set("Content-Type", "text/javascript; charset=utf-8");
      if (extension === ".wasm") headers.set("Content-Type", "application/wasm");
      headers.set("Content-Security-Policy", buildContentSecurityPolicy(apiOrigin));
      return new Response(result.body, { status: result.status, headers });
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const createWindow = () => {
      window = new BrowserWindow({
        width: 1440,
        height: 980,
        minWidth: 390,
        minHeight: 640,
        title: "Viễn Du",
        backgroundColor: "#f6f6f1",
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        const target = new URL(url);
        if (target.protocol !== "viendu:" || target.host !== "app")
          event.preventDefault();
      });
      window.on("closed", () => {
        window = null;
      });
      void window.loadURL("viendu://app/");
    };
    createWindow();
    app.on("activate", () => {
      if (!window) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
