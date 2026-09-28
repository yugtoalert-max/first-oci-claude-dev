import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // npm test は Docker 不要のテストだけを実行する(SPEC 9.3)
    include: ["packages/*/src/**/*.test.ts"],
  },
});
