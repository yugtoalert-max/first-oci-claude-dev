import { defineConfig } from "vite";

// 開発サーバー(npm run dev)の /api を、手元の API サーバー(npm run dev:api)に中継する。
// apps/web/.env で VITE_API_BASE_URL=/api にしたときに使われる。
// stg の API を直接呼ぶとき(VITE_API_BASE_URL=https://<host>/api)は、この中継は使われない
const localApiPort = process.env.LOCAL_API_PORT ?? "8787";

export default defineConfig({
  server: {
    proxy: { "/api": `http://127.0.0.1:${localApiPort}` },
  },
});
