import { describe, expect, it } from "vitest";
import { extractBearerToken, tokensMatch } from "./bearer";

const TOKEN = "q3Zb0N1x-_Ab9cDeFgHiJkLmNoPqRsTuVwXyZ012345";

describe("extractBearerToken", () => {
  it("Bearer のあとのトークンを取り出す", () => {
    expect(extractBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
  });

  it("スキーム名の大文字・小文字は区別しない(RFC 9110)", () => {
    expect(extractBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(extractBearerToken(`BEARER ${TOKEN}`)).toBe(TOKEN);
  });

  it("スキームとトークンの間の空白が複数でも、前後に空白があってもよい", () => {
    expect(extractBearerToken(`  Bearer   ${TOKEN}  `)).toBe(TOKEN);
  });

  it.each([
    ["ヘッダーがない", undefined],
    ["null", null],
    ["空文字", ""],
    ["スキームだけ", "Bearer"],
    ["スキームと空白だけ", "Bearer   "],
    ["別のスキーム", `Basic ${TOKEN}`],
    ["スキームがない", TOKEN],
    ["トークンが 2 つ", `Bearer ${TOKEN} ${TOKEN}`],
    ["token68 にない文字", "Bearer abc,def"],
    ["複数の値(配列)", [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]],
    ["1 つだけの配列も受け付けない", [`Bearer ${TOKEN}`]],
    ["文字列でない", 123],
  ])("取り出せない: %s", (_label, value) => {
    expect(extractBearerToken(value)).toBeUndefined();
  });
});

describe("tokensMatch", () => {
  it("同じなら true", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
  });

  it("1 文字でも違えば false", () => {
    expect(tokensMatch(`${TOKEN.slice(0, -1)}6`, TOKEN)).toBe(false);
  });

  it("長さが違っても例外を投げずに false", () => {
    expect(tokensMatch(TOKEN.slice(0, 10), TOKEN)).toBe(false);
    expect(tokensMatch(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokensMatch("", TOKEN)).toBe(false);
  });
});
