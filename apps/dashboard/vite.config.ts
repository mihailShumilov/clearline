import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static SPA → Cloudflare Pages. API base is configurable via VITE_API_BASE
// (defaults to the local `wrangler dev` API in the app code).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: "dist", sourcemap: true },
});
