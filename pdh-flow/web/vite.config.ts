import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "bundle",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8765",
      "/assets/xterm.js": "http://localhost:8765",
      "/assets/xterm.css": "http://localhost:8765",
      "/assets/xterm-addon-fit.js": "http://localhost:8765",
      "/assets/xterm-addon-web-links.js": "http://localhost:8765",
      "/assets/markdown-it.js": "http://localhost:8765",
    },
  },
});
