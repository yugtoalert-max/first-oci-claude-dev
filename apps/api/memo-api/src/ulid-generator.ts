import type { IdGenerator, MemoId } from "@memo/core";

/** 乱数のバイト列を返す。実行環境では crypto.randomBytes */
export type RandomBytes = (size: number) => Uint8Array;

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_BYTES = 10;
const RANDOM_MAX = (1n << 80n) - 1n;

function encode(value: bigint, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) {
    text = CROCKFORD_BASE32.charAt(Number(value % 32n)) + text;
    value /= 32n;
  }
  return text;
}

function toBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/**
 * 本番用の IdGenerator(SPEC 3.2)。
 * 同じミリ秒に続けて作るときは、乱数部分に 1 を足して順序を保つ(ULID の monotonic)。
 * 時刻が戻ったときは、時刻部分を渡された時刻のままにする(createdAt と同じ時刻で作るため。そのときの順序は保証しない)
 */
export class MonotonicUlidGenerator implements IdGenerator {
  private lastTime: number | undefined;
  private lastRandom = 0n;

  constructor(private readonly random: RandomBytes) {}

  generate(time: Date): MemoId {
    const ms = time.getTime();
    if (ms === this.lastTime) {
      if (this.lastRandom === RANDOM_MAX) {
        throw new Error("ULID random part overflowed within the same millisecond");
      }
      this.lastRandom += 1n;
    } else {
      this.lastTime = ms;
      this.lastRandom = toBigInt(this.random(RANDOM_BYTES));
    }
    return encode(BigInt(ms), 10) + encode(this.lastRandom, 16);
  }
}
