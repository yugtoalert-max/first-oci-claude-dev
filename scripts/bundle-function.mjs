// Function のエントリポイント(src/func.ts)を、依存パッケージごと 1 ファイル(dist/func.cjs)にまとめる。
// 各 Function のワークスペースのディレクトリで実行する(npm run bundle)
//
// npm workspaces のままではコンテナの中で @memo/core を解決できないので、
// Dockerfile には node_modules を入れず、この 1 ファイルだけを入れる
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

/**
 * oracle-nosqldb の lib/constants.js は、package.json を読んだあとに
 * delete require.cache[require.resolve('../package.json')] を実行する。
 * 1 ファイルにまとめると package.json は中に取り込まれるが、require.resolve は実行時のパスで解決しようとして
 * 見つからず、モジュールの読み込みで例外になる。キャッシュを消すだけの行なので取り除く。
 * 該当の行が見つからなければ(SDK の更新で変わったら)ビルドを失敗させる
 */
const removeNoSqlPackageJsonCacheDelete = {
  name: "remove-nosql-package-json-cache-delete",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /[\\/]oracle-nosqldb[\\/]lib[\\/]constants\.js$/ }, async (args) => {
      const target = "delete require.cache[require.resolve('../package.json')];";
      const source = await readFile(args.path, "utf8");
      if (!source.includes(target)) {
        throw new Error(`expected line not found in ${args.path}: ${target}`);
      }
      return { contents: source.replace(target, ""), loader: "js" };
    });
  },
};

const result = await build({
  entryPoints: ["src/func.ts"],
  outfile: "dist/func.cjs",
  bundle: true,
  platform: "node",
  // OCI Functions の Node.js の既定のバージョン(ベースイメージ fnproject/node:24)
  target: "node24",
  // 依存パッケージ(FDK・OCI SDK・NoSQL SDK)が CommonJS なので、出力も CommonJS にする
  format: "cjs",
  plugins: [removeNoSqlPackageJsonCacheDelete],
  logLevel: "info",
});

// 警告(実行時に解決できない require など)を見逃さないよう、警告があれば失敗にする
if (result.warnings.length > 0) {
  console.error(`bundle has ${result.warnings.length} warning(s)`);
  process.exit(1);
}
