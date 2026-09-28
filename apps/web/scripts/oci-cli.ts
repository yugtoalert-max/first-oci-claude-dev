import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { parseDeployEnv, type DeployEnv } from "./deploy-env.ts";
import { formatCommand } from "./oci-command.ts";

// 配置スクリプトの中で、ファイルと OCI CLI に触れる部分。判断はここに置かず、組み立て済みの引数を実行するだけ

/** リポジトリのルートの .env(Git 管理外) */
const DEFAULT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

export function loadDeployEnv(envFile: string | undefined): DeployEnv {
  const path = envFile === undefined ? DEFAULT_ENV_FILE : resolve(envFile);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read the env file ${path}. Copy .env.example to .env and set the values.`, {
      cause: error,
    });
  }
  return parseDeployEnv(parseEnv(text));
}

/** 実行する前に、実行するコマンドを表示する */
export function printCommand(args: readonly string[]): void {
  console.log(`$ ${formatCommand(args)}`);
}

/** 出力をそのまま端末に出す。OCI CLI が確認を求めたら、端末で答えられる */
export function runOci(args: readonly string[]): void {
  printCommand(args);
  const result = spawnSync("oci", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`oci exited with status ${result.status}`);
}

/** 標準出力を文字列で受け取る(一覧の JSON など) */
export function captureOci(args: readonly string[]): string {
  printCommand(args);
  return execFileSync("oci", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** 例外のメッセージだけを出して、終了コードを 1 にする */
export async function main(run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
