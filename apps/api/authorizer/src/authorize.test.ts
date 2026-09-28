import { describe, expect, it } from "vitest";
import { AUTH_RESULT_TTL_MS, createAuthorizer } from "./authorize";

const TOKEN = "q3Zb0N1x-_Ab9cDeFgHiJkLmNoPqRsTuVwXyZ012345";
const NOW = new Date("2026-09-28T01:23:45.678Z");

function setup(expected: string | Error = TOKEN) {
  let fetches = 0;
  const authorize = createAuthorizer({
    getExpectedToken: async () => {
      fetches += 1;
      if (expected instanceof Error) throw expected;
      return expected;
    },
    now: () => NOW,
  });
  return { authorize, fetches: () => fetches };
}

/** API Gateway が複数引数の authorizer Function に送る形 */
function input(authorization: unknown) {
  return { type: "USER_DEFINED", data: { authorization } };
}

const REJECTED = { active: false, wwwAuthenticate: "Bearer" };

describe("createAuthorizer", () => {
  it("トークンが一致すれば active: true と、結果をキャッシュしてよい期限(5 分後)を返す", async () => {
    const { authorize } = setup();

    expect(await authorize(input(`Bearer ${TOKEN}`))).toEqual({
      active: true,
      expiresAt: "2026-09-28T01:28:45.678Z",
    });
    expect(AUTH_RESULT_TTL_MS).toBe(300_000);
  });

  it("トークンが一致しなければ active: false と WWW-Authenticate の値を返す", async () => {
    const { authorize } = setup();

    expect(await authorize(input(`Bearer ${TOKEN.slice(0, -1)}6`))).toEqual(REJECTED);
  });

  it.each([
    ["Authorization がない(引数が渡らない)", { type: "USER_DEFINED", data: {} }],
    ["Bearer でない", input(`Basic ${TOKEN}`)],
    ["Authorization が複数(配列で渡る)", input([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`])],
    ["単一引数の形式", { type: "TOKEN", token: TOKEN }],
    ["data がない", { type: "USER_DEFINED" }],
    ["オブジェクトでない", "Bearer x"],
    ["null", null],
  ])("トークンを取り出せないときは、Vault を読まずに拒否する: %s", async (_label, body) => {
    const { authorize, fetches } = setup();

    expect(await authorize(body)).toEqual(REJECTED);
    expect(fetches()).toBe(0);
  });

  it("Vault から読めないときは例外を投げる(FDK が 5xx を返し、API Gateway は 502 にする)", async () => {
    const { authorize } = setup(new Error("vault unavailable"));

    await expect(authorize(input(`Bearer ${TOKEN}`))).rejects.toThrow("vault unavailable");
  });

  it.each([
    ["空", ""],
    ["短い(32 バイトの base64url の 43 文字に満たない)", TOKEN.slice(0, 42)],
    ["改行付き", `${TOKEN}\n`],
    ["base64url にない文字", `${TOKEN.slice(0, -1)}=`],
  ])(
    "シークレットの値がトークンの形式(SPEC 7 章)でなければ、設定の誤りとして例外を投げる: %s",
    async (_label, expected) => {
      const { authorize } = setup(expected);

      await expect(authorize(input(`Bearer ${expected || TOKEN}`))).rejects.toThrow(
        /secret value is not a valid token/,
      );
    },
  );

  it("例外のメッセージにシークレットの値を含めない", async () => {
    const { authorize } = setup("short-secret");

    await expect(authorize(input("Bearer short-secret"))).rejects.not.toThrow(/short-secret/);
  });
});
