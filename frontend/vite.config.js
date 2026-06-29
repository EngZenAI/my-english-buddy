import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// 개발 서버(5173)에서 백엔드(8000)로 API/인증 요청 프록시
const backendProxy = { target: "http://localhost:8000", changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": backendProxy,
      "^/auth/(cookie|google|register|password-reset|logout)": backendProxy,
      "/users": backendProxy,
    },
  },
  build: {
    outDir: "dist",
  },
});
