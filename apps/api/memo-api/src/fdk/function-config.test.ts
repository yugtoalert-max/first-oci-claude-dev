import { describe, expect, it } from "vitest";
import { readFunctionConfig } from "./function-config";

describe("readFunctionConfig", () => {
  it("テーブル名とコンパートメントを Function の設定から読む", () => {
    expect(
      readFunctionConfig({
        NOSQL_TABLE_NAME: "memos",
        NOSQL_COMPARTMENT_ID: "<compartment-ocid>",
        OTHER: "x",
      }),
    ).toEqual({ tableName: "memos", compartmentId: "<compartment-ocid>" });
  });

  it.each([
    [{ NOSQL_COMPARTMENT_ID: "c" }, /NOSQL_TABLE_NAME/],
    [{ NOSQL_TABLE_NAME: "memos" }, /NOSQL_COMPARTMENT_ID/],
    [{ NOSQL_TABLE_NAME: "", NOSQL_COMPARTMENT_ID: "c" }, /NOSQL_TABLE_NAME/],
    [{}, /NOSQL_TABLE_NAME, NOSQL_COMPARTMENT_ID/],
  ])("設定がない・空なら、足りない名前を挙げて例外を投げる(%j)", (env, message) => {
    expect(() => readFunctionConfig(env)).toThrow(message);
  });
});
