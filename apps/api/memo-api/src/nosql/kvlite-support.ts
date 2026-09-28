// テスト用(npm run test:contract)。アプリケーションのコードからは使わない
import { type Config, ErrorCode, NoSQLClient, NoSQLError, ServiceType } from "oracle-nosqldb";
import { memosTableDdl } from "./memos-table";
import { NOSQL_TIMEOUT_MS } from "./nosql-config";

/** npm run kvlite:up で起動するコンテナ。ポートを変えたいときは KVLITE_ENDPOINT で渡す */
export const KVLITE_ENDPOINT = process.env.KVLITE_ENDPOINT ?? "http://localhost:8080";

export const CONTRACT_TABLE = "memos_contract_test";

/** 起動直後の KVLite はしばらく応答しないので、テーブルを作れるまで待つ */
const STARTUP_WAIT_MS = 120_000;
const STARTUP_POLL_MS = 2_000;

/** 起動中の KVLite に接続したときのエラー。それ以外のエラーは待たずに投げる */
function isNotReady(error: unknown): boolean {
  return (
    error instanceof NoSQLError &&
    [ErrorCode.NETWORK_ERROR, ErrorCode.SERVICE_UNAVAILABLE, ErrorCode.REQUEST_TIMEOUT].includes(
      error.errorCode,
    )
  );
}

export function kvliteNoSqlConfig(endpoint: string): Config {
  return { serviceType: ServiceType.KVSTORE, endpoint, timeout: NOSQL_TIMEOUT_MS };
}

/** KVLite に接続し、契約テスト用のテーブルを(なければ)作る */
export async function connectKvlite(): Promise<NoSQLClient> {
  const client = new NoSQLClient(kvliteNoSqlConfig(KVLITE_ENDPOINT));
  const deadline = Date.now() + STARTUP_WAIT_MS;
  for (;;) {
    try {
      await client.tableDDL(memosTableDdl(CONTRACT_TABLE), { complete: true });
      return client;
    } catch (error) {
      if (!isNotReady(error)) {
        await client.close();
        throw error;
      }
      if (Date.now() >= deadline) {
        await client.close();
        throw new Error(
          `KVLite(${KVLITE_ENDPOINT})に接続できません。npm run kvlite:up で起動してください`,
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_MS));
    }
  }
}

/** テストごとにテーブルを空にする */
export async function clearTable(client: NoSQLClient): Promise<void> {
  for await (const _ of client.queryIterable(`DELETE FROM ${CONTRACT_TABLE}`)) {
    // 結果(削除した件数)は使わない
  }
}
