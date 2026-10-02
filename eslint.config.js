// ESLint の設定(flat config)。typescript-eslint の推奨設定に、型情報を使うルールを加える。
// typescript-eslint は TypeScript 7 の API に未対応なので、`typescript` には TypeScript 6 の互換パッケージ
// (@typescript/typescript6)を入れている。tsc は @typescript/native(TypeScript 7)を使う
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // どの tsconfig.json にも入っていない、ルートの設定ファイル
          allowDefaultProject: ["vitest.config.ts", "vitest.contract.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // インターフェースが Promise を返すので、テストのフェイクやメモリ上の実装は await のない async で書く
      "@typescript-eslint/require-await": "off",
      // 使わない引数や変数は _ で始める
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // apps/web の Node.js 側(配置スクリプトと vite の設定)は tsconfig.node.json に入っている。
    // project service は tsconfig.json しか探さないので、明示する
    files: ["apps/web/scripts/**/*.ts", "apps/web/vite.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./apps/web/tsconfig.node.json",
      },
    },
  },
  {
    // expect.any() などの非対称マッチャーは any を返す
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
  {
    files: ["apps/web/src/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // 設定ファイルとビルド用のスクリプトは型チェックの対象外
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
