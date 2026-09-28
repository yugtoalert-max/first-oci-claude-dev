// npm run deploy:web(SPEC 10.6)。apps/web/dist をバケットと同期する。人が実行する
//
//   npm run deploy:web                            … ビルドしてから、リポジトリのルートの .env の配置先に同期する
//   npm run deploy:web -- --dry-run               … 実行されるはずの oci コマンドを表示するだけ(OCI には接続しない)
//   npm run deploy:web -- --env-file .env.prod    … 別の .env を使う
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./deploy-env.ts";
import { planDeletions, planUploads } from "./deploy-plan.ts";
import { captureOci, loadDeployEnv, main, printCommand, runOci } from "./oci-cli.ts";
import {
  deleteObjectArgs,
  formatCommand,
  listObjectsArgs,
  parseObjectList,
  putObjectArgs,
} from "./oci-command.ts";

const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));

/** dist/ の下のファイルを、オブジェクト名(区切りは /)で返す */
async function listDistFiles(): Promise<string[]> {
  const entries = await readdir(DIST_DIR, { recursive: true, withFileTypes: true }).catch((error) => {
    throw new Error(`Cannot read ${DIST_DIR}. Run npm run build first.`, { cause: error });
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(DIST_DIR, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

await main(async () => {
  const options = parseCliArgs(process.argv.slice(2));
  const env = loadDeployEnv(options.envFile);
  const localNames = await listDistFiles();
  // Content-Type を決められないファイルがあれば、ここで(アップロードを始める前に)止まる
  const uploads = planUploads(localNames);
  const fileOf = (name: string) => relative(process.cwd(), join(DIST_DIR, name));

  console.log(`# 配置先: バケット ${env.bucket}(プロファイル ${env.profile}、リージョン ${env.region})`);
  if (options.dryRun) {
    console.log("# ドライラン: 次の oci コマンドを表示するだけで、実行しません");
    printCommand(listObjectsArgs(env));
    for (const upload of uploads) printCommand(putObjectArgs(env, fileOf(upload.name), upload));
    console.log("# 最後に、最初の一覧にあって dist/ にないオブジェクトを 1 つずつ削除します:");
    console.log(`#   ${formatCommand(deleteObjectArgs(env, "<オブジェクト名>"))}`);
    return;
  }

  // 1. 今のバケットの中身。削除の対象を決めるために、アップロードの前に取る
  const remoteNames = parseObjectList(captureOci(listObjectsArgs(env)));
  // 2. assets/* → その他 → index.html の順にアップロードする
  for (const upload of uploads) runOci(putObjectArgs(env, fileOf(upload.name), upload));
  // 3. 新しい index.html を置いてから、dist/ にないものを消す
  const deletions = planDeletions(remoteNames, localNames);
  for (const name of deletions) runOci(deleteObjectArgs(env, name));

  console.log(`# 完了: アップロード ${uploads.length} 件、削除 ${deletions.length} 件`);
});
