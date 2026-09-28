import { isMemoId } from "@memo/core";
import { describe, expect, it } from "vitest";
import { MonotonicUlidGenerator } from "./ulid-generator";

// ULID の仕様にある例: 1469918176385 → 01ARYZ6S41
const TIME = new Date(1469918176385);
const TIME_PART = "01ARYZ6S41";

/** 決まったバイト列を順に返す乱数 */
function fixedRandom(...values: number[][]) {
  const sizes: number[] = [];
  const random = (size: number) => {
    sizes.push(size);
    const next = values.shift();
    if (next === undefined) throw new Error("no more random values");
    return Uint8Array.from(next);
  };
  return { random, sizes };
}

const ZEROS = Array.from({ length: 10 }, () => 0);
const ONES = Array.from({ length: 10 }, () => 0xff);

describe("MonotonicUlidGenerator", () => {
  it("時刻部分(先頭 10 文字)は渡された時刻、乱数部分(残り 16 文字)は 80 ビットの乱数から作る", () => {
    const { random, sizes } = fixedRandom([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);

    const id = new MonotonicUlidGenerator(random).generate(TIME);

    expect(id).toBe(`${TIME_PART}0000000000000001`);
    expect(isMemoId(id)).toBe(true);
    expect(sizes).toEqual([10]);
  });

  it("乱数部分は Crockford Base32 の大文字で書く", () => {
    const { random } = fixedRandom(ONES);

    expect(new MonotonicUlidGenerator(random).generate(TIME)).toBe(`${TIME_PART}ZZZZZZZZZZZZZZZZ`);
  });

  it("同じミリ秒の 2 回目は、乱数を引き直さずに前の乱数部分に 1 を足す(順序が保たれる)", () => {
    const { random, sizes } = fixedRandom(ZEROS);
    const generator = new MonotonicUlidGenerator(random);

    const first = generator.generate(TIME);
    const second = generator.generate(new Date(TIME.getTime()));

    expect(first).toBe(`${TIME_PART}0000000000000000`);
    expect(second).toBe(`${TIME_PART}0000000000000001`);
    expect(second > first).toBe(true);
    expect(sizes).toEqual([10]);
  });

  it("ミリ秒が変われば乱数を引き直す", () => {
    const { random, sizes } = fixedRandom(ONES, ZEROS);
    const generator = new MonotonicUlidGenerator(random);

    generator.generate(TIME);
    const next = generator.generate(new Date(TIME.getTime() + 1));

    expect(next).toBe("01ARYZ6S420000000000000000");
    expect(sizes).toEqual([10, 10]);
  });

  it("時刻が戻っても、時刻部分は渡された時刻にする(createdAt と同じ時刻を保つ)", () => {
    const { random } = fixedRandom(ZEROS, ZEROS);
    const generator = new MonotonicUlidGenerator(random);

    generator.generate(new Date(TIME.getTime() + 1));
    const earlier = generator.generate(TIME);

    expect(earlier.slice(0, 10)).toBe(TIME_PART);
  });

  it("同じミリ秒で乱数部分が上限を超えるときは例外を投げる", () => {
    const { random } = fixedRandom(ONES);
    const generator = new MonotonicUlidGenerator(random);
    generator.generate(TIME);

    expect(() => generator.generate(TIME)).toThrow();
  });
});
