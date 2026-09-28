// Function の設定(OCI Functions では環境変数として渡る)。値は Terraform で設定する

export type FunctionConfig = {
  tableName: string;
  compartmentId: string;
};

const KEYS = { tableName: "NOSQL_TABLE_NAME", compartmentId: "NOSQL_COMPARTMENT_ID" } as const;

/** 足りない設定があれば、その名前を挙げて例外を投げる */
export function readFunctionConfig(env: Record<string, string | undefined>): FunctionConfig {
  const missing = Object.values(KEYS).filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`missing function config: ${missing.join(", ")}`);
  }
  return { tableName: env[KEYS.tableName] ?? "", compartmentId: env[KEYS.compartmentId] ?? "" };
}
