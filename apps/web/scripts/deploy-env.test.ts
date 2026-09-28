import { describe, expect, it } from "vitest";
import { parseCliArgs, parseDeployEnv } from "./deploy-env.ts";

describe("parseDeployEnv", () => {
  it(".env の値から配置先を作る", () => {
    expect(
      parseDeployEnv({
        OCI_NAMESPACE: "ns1",
        OCI_BUCKET: "web-stg",
        OCI_PROFILE: "STG",
        OCI_REGION: "ap-tokyo-1",
        UNRELATED: "x",
      }),
    ).toEqual({ namespace: "ns1", bucket: "web-stg", profile: "STG", region: "ap-tokyo-1" });
  });

  it("前後の空白は取り除く", () => {
    expect(
      parseDeployEnv({ OCI_NAMESPACE: " ns1 ", OCI_BUCKET: "b", OCI_PROFILE: "p", OCI_REGION: "r" }),
    ).toEqual({ namespace: "ns1", bucket: "b", profile: "p", region: "r" });
  });

  it("足りない(未設定・空)値があれば、その名前をすべて挙げて例外を投げる", () => {
    expect(() => parseDeployEnv({ OCI_NAMESPACE: "ns1", OCI_BUCKET: " " })).toThrow(
      "Missing settings in the env file: OCI_BUCKET, OCI_PROFILE, OCI_REGION",
    );
  });
});

describe("parseCliArgs", () => {
  it("引数なしなら、実際に実行し、既定の .env を使う", () => {
    expect(parseCliArgs([])).toEqual({ dryRun: false, envFile: undefined });
  });

  it("--dry-run と --env-file を受け取る", () => {
    expect(parseCliArgs(["--dry-run", "--env-file", ".env.prod"])).toEqual({
      dryRun: true,
      envFile: ".env.prod",
    });
    expect(parseCliArgs(["--env-file=.env.prod"])).toEqual({ dryRun: false, envFile: ".env.prod" });
  });

  it("--env-file の値がない、または知らない引数なら例外", () => {
    expect(() => parseCliArgs(["--env-file"])).toThrow(/--env-file/);
    expect(() => parseCliArgs(["--env-file", "--dry-run"])).toThrow(/--env-file/);
    expect(() => parseCliArgs(["--force"])).toThrow(/--force/);
  });
});
