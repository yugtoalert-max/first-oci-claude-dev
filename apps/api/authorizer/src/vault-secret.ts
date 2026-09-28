import { ResourcePrincipalAuthenticationDetailsProvider } from "oci-common";
import { requests, SecretsClient } from "oci-secrets";

/** Vault のシークレットの取得に使う操作。テストでは偽物に差し替える */
export type SecretsClientPort = Pick<SecretsClient, "getSecretBundle">;

/** シークレットの現在のバージョン(CURRENT)の値を文字列で返す */
export async function fetchSecretValue(client: SecretsClientPort, secretId: string): Promise<string> {
  const response = await client.getSecretBundle({
    secretId,
    stage: requests.GetSecretBundleRequest.Stage.Current,
  });
  const content = response.secretBundle.secretBundleContent;
  if (content?.contentType !== "BASE64" || content.content === undefined) {
    throw new Error(`secret bundle has no BASE64 content (contentType: ${content?.contentType})`);
  }
  return Buffer.from(content.content, "base64").toString("utf8");
}

/**
 * リソースプリンシパル(Function 自身の ID)で認証する SecretsClient を作る。
 * リージョンもリソースプリンシパルのものを使う。
 * リソースプリンシパルの環境変数は Functions の実行環境にしかないので、呼び出されるまで作らない
 */
export function createResourcePrincipalSecretsClient(): SecretsClient {
  return new SecretsClient({
    authenticationDetailsProvider: ResourcePrincipalAuthenticationDetailsProvider.builder(),
  });
}
