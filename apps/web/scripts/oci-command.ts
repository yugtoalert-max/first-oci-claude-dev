import type { DeployEnv } from "./deploy-env.ts";
import type { Upload } from "./deploy-plan.ts";

// OCI CLI(oci)に渡す引数。組み立てだけを行い、実行は deploy-web.ts / clean-web.ts が行う

function target(env: DeployEnv): string[] {
  return ["--namespace-name", env.namespace, "--bucket-name", env.bucket];
}

function common(env: DeployEnv): string[] {
  return ["--profile", env.profile, "--region", env.region];
}

export function putObjectArgs(env: DeployEnv, file: string, upload: Upload): string[] {
  return [
    "os", "object", "put",
    ...target(env),
    "--name", upload.name,
    "--file", file,
    "--content-type", upload.contentType,
    "--cache-control", upload.cacheControl,
    // 同じ名前のオブジェクトがあれば確認なしで上書きする
    "--force",
    ...common(env),
  ];
}

export function deleteObjectArgs(env: DeployEnv, name: string): string[] {
  return ["os", "object", "delete", ...target(env), "--object-name", name, "--force", ...common(env)];
}

export function listObjectsArgs(env: DeployEnv): string[] {
  return ["os", "object", "list", ...target(env), "--all", "--fields", "name", ...common(env)];
}

/** バケットを空にする。--force を付けないので、OCI CLI が件数を出して確認する */
export function bulkDeleteArgs(env: DeployEnv): string[] {
  return ["os", "object", "bulk-delete", ...target(env), ...common(env)];
}

/** oci os object list の出力(JSON)からオブジェクト名を取り出す。空のバケットでは出力が空のことがある */
export function parseObjectList(stdout: string): string[] {
  if (stdout.trim() === "") return [];
  const parsed = JSON.parse(stdout) as { data?: unknown };
  if (parsed.data === undefined) return [];
  if (!Array.isArray(parsed.data)) throw new Error("Unexpected output of oci os object list: data is not an array");
  return parsed.data.map((item: unknown) => {
    const name = (item as { name?: unknown } | null)?.name;
    if (typeof name !== "string") {
      throw new Error("Unexpected output of oci os object list: an object has no name");
    }
    return name;
  });
}

function quote(value: string): string {
  if (/^[A-Za-z0-9_\-./:=,@%+]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** 表示用。シェルにそのまま貼れる形にする */
export function formatCommand(args: readonly string[]): string {
  return ["oci", ...args.map(quote)].join(" ");
}
