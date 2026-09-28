// authorizer Function のエントリポイント。esbuild で 1 ファイルにまとめてコンテナイメージに入れる
import { handle } from "@fnproject/fdk";
import type { SecretsClient } from "oci-secrets";
import { createAuthorizer } from "./authorize";
import { readFunctionConfig } from "./function-config";
import { cacheSecret } from "./secret-cache";
import { createResourcePrincipalSecretsClient, fetchSecretValue } from "./vault-secret";

/** シークレットの値をモジュールのスコープにキャッシュする時間(SPEC 7 章) */
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

// 設定が足りなければ、読み込みの時点で止める
const config = readFunctionConfig(process.env);

// リソースプリンシパルの環境変数は Functions の実行環境にしかないので、最初に Vault を読むときに作る
let client: SecretsClient | undefined;

const authorize = createAuthorizer({
  getExpectedToken: cacheSecret({
    fetch: () => fetchSecretValue((client ??= createResourcePrincipalSecretsClient()), config.secretId),
    now: Date.now,
    ttlMs: SECRET_CACHE_TTL_MS,
  }),
  now: () => new Date(),
});

handle((input) => authorize(input));
