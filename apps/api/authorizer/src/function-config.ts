// Function の設定(OCI Functions では環境変数として渡る)。値は Terraform で設定する

export type FunctionConfig = {
  /** 認証トークンを入れた Vault のシークレットの OCID */
  secretId: string;
};

const SECRET_ID_KEY = "AUTH_TOKEN_SECRET_ID";

/** 足りない設定があれば、その名前を挙げて例外を投げる */
export function readFunctionConfig(env: Record<string, string | undefined>): FunctionConfig {
  const secretId = env[SECRET_ID_KEY];
  if (!secretId) throw new Error(`missing function config: ${SECRET_ID_KEY}`);
  return { secretId };
}
