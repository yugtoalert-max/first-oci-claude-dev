import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_AFTER_SECONDS, retryAvailableAt, secondsUntil } from "./retry";

const NOW = Date.parse("2026-09-28T01:23:45.678Z");

describe("retryAvailableAt", () => {
  it("Retry-After の秒数だけ先の時刻を返す", () => {
    expect(retryAvailableAt(NOW, 1)).toBe(NOW + 1_000);
    expect(retryAvailableAt(NOW, 30)).toBe(NOW + 30_000);
  });

  it("0 秒なら今すぐ", () => {
    expect(retryAvailableAt(NOW, 0)).toBe(NOW);
  });

  it("Retry-After がなければ既定の秒数を使う", () => {
    expect(retryAvailableAt(NOW, undefined)).toBe(NOW + DEFAULT_RETRY_AFTER_SECONDS * 1_000);
  });
});

describe("secondsUntil", () => {
  it("残りの秒数を切り上げて返す", () => {
    expect(secondsUntil(NOW + 1_000, NOW)).toBe(1);
    expect(secondsUntil(NOW + 1_000, NOW + 1)).toBe(1);
    expect(secondsUntil(NOW + 1_001, NOW)).toBe(2);
  });

  it("その時刻になったら、または過ぎたら 0", () => {
    expect(secondsUntil(NOW, NOW)).toBe(0);
    expect(secondsUntil(NOW, NOW + 5_000)).toBe(0);
  });
});
