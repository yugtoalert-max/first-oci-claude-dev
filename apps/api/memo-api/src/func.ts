// memo-api Function のエントリポイント。esbuild で 1 ファイルにまとめてコンテナイメージに入れる
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { handle } from "@fnproject/fdk";
import { NoSQLClient } from "oracle-nosqldb";
import { createFdkHandler } from "./fdk/fdk-bridge";
import { readFunctionConfig } from "./fdk/function-config";
import { createHandler } from "./handler";
import { cloudNoSqlConfig } from "./nosql/nosql-config";
import { NoSqlMemoRepository } from "./nosql/nosql-memo-repository";
import { MonotonicUlidGenerator } from "./ulid-generator";

// 設定が足りなければ、読み込みの時点で止める
const config = readFunctionConfig(process.env);

let fdkHandler: ReturnType<typeof createFdkHandler> | undefined;

/**
 * NoSQL クライアントはモジュールのスコープで 1 回だけ作り、以降の呼び出しで使い回す(SPEC 9.2)。
 * リソースプリンシパルの環境変数は Functions の実行環境にしかないので、最初の呼び出しまで作らない
 */
function getFdkHandler(): ReturnType<typeof createFdkHandler> {
  fdkHandler ??= createFdkHandler(
    createHandler({
      repository: new NoSqlMemoRepository({
        client: new NoSQLClient(cloudNoSqlConfig({ compartment: config.compartmentId })),
        tableName: config.tableName,
      }),
      clock: { now: () => new Date() },
      idGenerator: new MonotonicUlidGenerator(randomBytes),
      log: (line) => console.log(line),
      timer: () => performance.now(),
    }),
    // 一時的な診断(SPEC 13 章の 16)。原因がわかったら外す
    { logDiagnostic: (line) => console.log(line) },
  );
  return fdkHandler;
}

handle((body, ctx) => getFdkHandler()(body, ctx), { inputMode: "string" });
