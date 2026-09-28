import { describe, expect, it } from "vitest";
import { readFunctionConfig } from "./function-config";

describe("readFunctionConfig", () => {
  it("シークレットの OCID を Function の設定から読む", () => {
    expect(readFunctionConfig({ AUTH_TOKEN_SECRET_ID: "<secret-ocid>", OTHER: "x" })).toEqual({
      secretId: "<secret-ocid>",
    });
  });

  it.each([[{}], [{ AUTH_TOKEN_SECRET_ID: "" }]])(
    "設定がない・空なら、足りない名前を挙げて例外を投げる(%j)",
    (env) => {
      expect(() => readFunctionConfig(env)).toThrow(/AUTH_TOKEN_SECRET_ID/);
    },
  );
});
