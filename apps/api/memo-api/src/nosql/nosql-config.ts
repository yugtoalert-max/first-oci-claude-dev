import type { Config } from "oracle-nosqldb";

/** SDK の自動リトライを含めた、1 回の操作の打ち切り時間(SPEC 9.2) */
export const NOSQL_TIMEOUT_MS = 5000;

/** 本番用(クラウド、リソースプリンシパル)の設定 */
export function cloudNoSqlConfig(_options: { compartment: string }): Config {
  throw new Error("not implemented");
}
