import { describe, expect, it } from "vitest";
import { parseIfMatch, toEtag } from "./etag";

// SPEC 3.4: 強い ETag。バージョン文字列をダブルクォートで囲む。W/ は付けない

describe("toEtag", () => {
  it("バージョンをダブルクォートで囲む", () => {
    expect(toEtag("AAECAw")).toBe('"AAECAw"');
  });
});

describe("parseIfMatch", () => {
  it("ヘッダーがなければ absent", () => {
    expect(parseIfMatch(undefined)).toEqual({ kind: "absent" });
  });

  it("ダブルクォートを外してバージョンを返す", () => {
    expect(parseIfMatch('"AAECAw"')).toEqual({ kind: "version", version: "AAECAw" });
  });

  it("前後の空白は無視する", () => {
    expect(parseIfMatch('  "AAECAw" ')).toEqual({ kind: "version", version: "AAECAw" });
  });

  it("1 要素の配列は 1 つの値として扱う", () => {
    expect(parseIfMatch(['"AAECAw"'])).toEqual({ kind: "version", version: "AAECAw" });
  });

  it.each([
    ["*"],
    ['"a", "b"'],
    ['"a","b"'],
    ['W/"a"'],
    ["a"],
    ['"a'],
    ['""'],
    ['"a b"'],
    [""],
  ])("%j は invalid", (value) => {
    expect(parseIfMatch(value)).toEqual({ kind: "invalid" });
  });

  it("複数行で届いたら invalid", () => {
    expect(parseIfMatch(['"a"', '"b"'])).toEqual({ kind: "invalid" });
  });
});
