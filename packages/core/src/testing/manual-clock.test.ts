import { describe, expect, it } from "vitest";
import { ManualClock } from "./manual-clock";

describe("ManualClock", () => {
  it("設定した時刻を返し、advance で進める", () => {
    const clock = new ManualClock(new Date("2026-09-28T01:23:45.678Z"));

    expect(clock.now()).toEqual(new Date("2026-09-28T01:23:45.678Z"));
    clock.advance(1_000);
    expect(clock.now()).toEqual(new Date("2026-09-28T01:23:46.678Z"));
  });

  it("返した Date を書き換えても時計は変わらない", () => {
    const clock = new ManualClock(new Date("2026-09-28T01:23:45.678Z"));

    clock.now().setTime(0);

    expect(clock.now()).toEqual(new Date("2026-09-28T01:23:45.678Z"));
  });
});
