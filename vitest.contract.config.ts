import { defineConfig } from "vitest/config";

// npm run test:contract: KVLite(ローカルの Docker)を使う契約テスト(SPEC 9.3)。
// 先に npm run kvlite:up で KVLite を起動しておく
export default defineConfig({
  test: {
    include: ["apps/api/*/src/**/*.contract.test.ts"],
    // 起動直後の KVLite を待つ時間(kvlite-support.ts の STARTUP_WAIT_MS)より長くする
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
