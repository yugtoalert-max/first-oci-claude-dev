import { describe, expect, it } from "vitest";
import { cacheSecret } from "./secret-cache";

const TTL_MS = 5 * 60 * 1000;

function setup(results: Array<string | Error>) {
  let now = 1_000_000;
  let calls = 0;
  const getSecret = cacheSecret({
    fetch: async () => {
      const result = results[calls];
      calls += 1;
      if (result === undefined) throw new Error("unexpected fetch");
      if (result instanceof Error) throw result;
      return result;
    },
    now: () => now,
    ttlMs: TTL_MS,
  });
  return {
    getSecret,
    advance: (ms: number) => {
      now += ms;
    },
    calls: () => calls,
  };
}

describe("cacheSecret", () => {
  it("初回は取得し、有効期間の間はキャッシュを返す", async () => {
    const { getSecret, advance, calls } = setup(["v1"]);

    expect(await getSecret()).toBe("v1");
    advance(TTL_MS - 1);
    expect(await getSecret()).toBe("v1");
    expect(calls()).toBe(1);
  });

  it("有効期間が過ぎたら取得し直す", async () => {
    const { getSecret, advance, calls } = setup(["v1", "v2"]);

    await getSecret();
    advance(TTL_MS);

    expect(await getSecret()).toBe("v2");
    expect(calls()).toBe(2);
  });

  it("取得に失敗したら例外をそのまま伝え、失敗はキャッシュしない", async () => {
    const { getSecret, calls } = setup([new Error("vault unavailable"), "v1"]);

    await expect(getSecret()).rejects.toThrow("vault unavailable");
    expect(await getSecret()).toBe("v1");
    expect(calls()).toBe(2);
  });

  it("有効期間が過ぎたあとの取得に失敗したら、古い値は返さない", async () => {
    const { getSecret, advance } = setup(["v1", new Error("vault unavailable")]);

    await getSecret();
    advance(TTL_MS);

    await expect(getSecret()).rejects.toThrow("vault unavailable");
  });

  it("取得中に重ねて呼ばれたら、同じ取得の結果を待つ", async () => {
    const { getSecret, calls } = setup(["v1"]);

    const values = await Promise.all([getSecret(), getSecret()]);

    expect(values).toEqual(["v1", "v1"]);
    expect(calls()).toBe(1);
  });
});
