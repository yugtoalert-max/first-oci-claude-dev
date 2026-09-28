// npm run clean:web(SPEC 10.6)。バケットを空にする。terraform destroy の前に人が実行する
// (OCI のバケットは空でないと削除できない)
//
//   npm run clean:web                          … OCI CLI が削除する件数を出して確認する
//   npm run clean:web -- --dry-run             … 実行されるはずの oci コマンドを表示するだけ(OCI には接続しない)
//   npm run clean:web -- --env-file .env.prod  … 別の .env を使う
import { parseCliArgs } from "./deploy-env.ts";
import { loadDeployEnv, main, printCommand, runOci } from "./oci-cli.ts";
import { bulkDeleteArgs } from "./oci-command.ts";

await main(() => {
  const options = parseCliArgs(process.argv.slice(2));
  const env = loadDeployEnv(options.envFile);

  console.log(`# 対象: バケット ${env.bucket}(プロファイル ${env.profile}、リージョン ${env.region})`);
  if (options.dryRun) {
    console.log("# ドライラン: 次の oci コマンドを表示するだけで、実行しません");
    printCommand(bulkDeleteArgs(env));
    return;
  }
  runOci(bulkDeleteArgs(env));
});
