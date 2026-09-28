import { describe, expect, it } from "vitest";
import {
  bulkDeleteArgs,
  deleteObjectArgs,
  formatCommand,
  listObjectsArgs,
  parseObjectList,
  putObjectArgs,
} from "./oci-command.ts";

const ENV = { namespace: "ns1", bucket: "web-stg", profile: "STG", region: "ap-tokyo-1" };
const COMMON = ["--profile", "STG", "--region", "ap-tokyo-1"];

describe("oci コマンドの引数", () => {
  it("put: Content-Type と Cache-Control を付けて上書きする", () => {
    expect(
      putObjectArgs(ENV, "dist/assets/index-a.js", {
        name: "assets/index-a.js",
        contentType: "text/javascript; charset=utf-8",
        cacheControl: "public, max-age=31536000, immutable",
      }),
    ).toEqual([
      "os", "object", "put",
      "--namespace-name", "ns1",
      "--bucket-name", "web-stg",
      "--name", "assets/index-a.js",
      "--file", "dist/assets/index-a.js",
      "--content-type", "text/javascript; charset=utf-8",
      "--cache-control", "public, max-age=31536000, immutable",
      "--force",
      ...COMMON,
    ]);
  });

  it("delete: 1 つのオブジェクトを確認なしで消す", () => {
    expect(deleteObjectArgs(ENV, "assets/index-old.js")).toEqual([
      "os", "object", "delete",
      "--namespace-name", "ns1",
      "--bucket-name", "web-stg",
      "--object-name", "assets/index-old.js",
      "--force",
      ...COMMON,
    ]);
  });

  it("list: 全ページの名前だけを取る", () => {
    expect(listObjectsArgs(ENV)).toEqual([
      "os", "object", "list",
      "--namespace-name", "ns1",
      "--bucket-name", "web-stg",
      "--all",
      "--fields", "name",
      ...COMMON,
    ]);
  });

  it("bulk-delete: --force を付けない(OCI CLI が件数を出して確認する)", () => {
    expect(bulkDeleteArgs(ENV)).toEqual([
      "os", "object", "bulk-delete",
      "--namespace-name", "ns1",
      "--bucket-name", "web-stg",
      ...COMMON,
    ]);
  });
});

describe("parseObjectList", () => {
  it("oci os object list の JSON から名前を取り出す", () => {
    const stdout = JSON.stringify({
      data: [{ name: "index.html" }, { name: "assets/index-a.js" }],
      prefixes: [],
    });
    expect(parseObjectList(stdout)).toEqual(["index.html", "assets/index-a.js"]);
  });

  it("空のバケット(出力が空、または data がない)なら空の配列", () => {
    expect(parseObjectList("")).toEqual([]);
    expect(parseObjectList("  \n")).toEqual([]);
    expect(parseObjectList(JSON.stringify({ prefixes: [] }))).toEqual([]);
  });

  it("想定と違う形なら例外(削除の対象を誤らないため)", () => {
    expect(() => parseObjectList("not json")).toThrow();
    expect(() => parseObjectList(JSON.stringify({ data: {} }))).toThrow(/data/);
    expect(() => parseObjectList(JSON.stringify({ data: [{ size: 1 }] }))).toThrow(/name/);
  });
});

describe("formatCommand", () => {
  it("シェルにそのまま貼れる形にする(空白や ; を含む値は単一引用符で囲む)", () => {
    expect(
      formatCommand(["os", "object", "put", "--content-type", "text/html; charset=utf-8", "--name", "index.html"]),
    ).toBe("oci os object put --content-type 'text/html; charset=utf-8' --name index.html");
  });

  it("単一引用符を含む値はエスケープする", () => {
    expect(formatCommand(["--name", "it's"])).toBe(`oci --name 'it'\\''s'`);
  });

  it("空文字は '' にする", () => {
    expect(formatCommand(["--name", ""])).toBe("oci --name ''");
  });
});
