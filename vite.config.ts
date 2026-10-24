import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const localApiProxy = () => ({
  "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
});

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "localhost", port: 8084, strictPort: true,
    proxy: localApiProxy(),
    watch: {
      ignored: [
        "**/desktop/dist/**", "**/desktop/web-dist/**", "**/desktop/release/**",
        "**/backend/dist/**", "**/backend/.local-data/**",
      ],
    },
  },
  preview: {
    host: "localhost",
    port: 8084,
    strictPort: true,
    allowedHosts: ["viendu.up.railway.app"],
    proxy: localApiProxy(),
  },
  build: { outDir: "dist" },
});
