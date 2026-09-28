import { type Config, ServiceType } from "oracle-nosqldb";

/**
 * SDK の自動リトライを含めた、1 回の操作の打ち切り時間(SPEC 9.2)。
 * SDK の timeout はリトライとその待ち時間を含めた累積で、超えると NoSQLTimeoutError になる
 */
export const NOSQL_TIMEOUT_MS = 5000;

/**
 * 本番用(クラウド、リソースプリンシパル)の設定。
 * リージョンはリソースプリンシパルのものが使われるので指定しない。
 * クライアントはこの設定から new NoSQLClient(config) で作り、モジュールのスコープで使い回す(SPEC 9.2)
 */
export function cloudNoSqlConfig(options: { compartment: string }): Config {
  return {
    serviceType: ServiceType.CLOUD,
    compartment: options.compartment,
    auth: { iam: { useResourcePrincipal: true } },
    timeout: NOSQL_TIMEOUT_MS,
  };
}
