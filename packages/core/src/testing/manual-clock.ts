import type { Clock } from "../ports";

/** テスト用の時計。advance を呼ぶまで時刻が進まない */
export class ManualClock implements Clock {
  private time: number;

  constructor(initial: Date) {
    this.time = initial.getTime();
  }

  now(): Date {
    return new Date(this.time);
  }

  advance(ms: number): void {
    this.time += ms;
  }
}
