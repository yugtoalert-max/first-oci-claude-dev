import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // npm test は Docker 不要のテストだけを実行する(SPEC 9.3)。
    // KVLite を使う *.contract.test.ts は npm run test:contract(vitest.contract.config.ts)で実行する
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/api/*/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/web/scripts/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, "**/*.contract.test.ts"],
  },
});
