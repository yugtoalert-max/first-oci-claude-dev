import { describe, expect, it } from "vitest";
import { isMemoId } from "../id";
import { SequentialIdGenerator } from "./sequential-id-generator";

describe("SequentialIdGenerator", () => {
  it("ULID の形式の id を作る", () => {
    expect(isMemoId(new SequentialIdGenerator().generate(new Date()))).toBe(true);
  });

  it("先頭 10 文字は渡された時刻(ULID の時刻部分)", () => {
    // ULID の仕様にある例: 1469918176385 → 01ARYZ6S41
    const id = new SequentialIdGenerator().generate(new Date(1469918176385));

    expect(id.slice(0, 10)).toBe("01ARYZ6S41");
  });

  it("同じ時刻で続けて作っても、文字列として増えていく", () => {
    const generator = new SequentialIdGenerator();
    const at = new Date("2026-09-28T01:23:45.678Z");

    const ids = [generator.generate(at), generator.generate(at), generator.generate(at)];

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });
});
