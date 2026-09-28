// 配置スクリプトの設定(SPEC 10.6)。環境固有の値は Git 管理外の .env から読む

export type DeployEnv = {
  namespace: string;
  bucket: string;
  /** OCI CLI のプロファイル(~/.oci/config のセクション名) */
  profile: string;
  region: string;
};

const KEYS = {
  namespace: "OCI_NAMESPACE",
  bucket: "OCI_BUCKET",
  profile: "OCI_PROFILE",
  region: "OCI_REGION",
} as const;

/** 足りない値があれば、その名前をすべて挙げて例外を投げる */
export function parseDeployEnv(values: Record<string, string | undefined>): DeployEnv {
  const read = (key: string) => values[key]?.trim() ?? "";
  const missing = Object.values(KEYS).filter((key) => read(key) === "");
  if (missing.length > 0) {
    throw new Error(`Missing settings in the env file: ${missing.join(", ")}`);
  }
  return {
    namespace: read(KEYS.namespace),
    bucket: read(KEYS.bucket),
    profile: read(KEYS.profile),
    region: read(KEYS.region),
  };
}

export type CliOptions = {
  /** 実行されるはずの oci コマンドを表示するだけで、実行しない */
  dryRun: boolean;
  /** 省略したらリポジトリのルートの .env */
  envFile: string | undefined;
};

export function parseCliArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = { dryRun: false, envFile: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
    } else if (arg === "--env-file") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error("--env-file needs a path");
      options.envFile = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}
