import type { MemoId } from "../memo";
import type { IdGenerator } from "../ports";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(value: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) {
    text = CROCKFORD_BASE32.charAt(value % 32) + text;
    value = Math.floor(value / 32);
  }
  return text;
}

/**
 * テスト用の IdGenerator。
 * 時刻部分(先頭 10 文字)は ULID と同じ形式にし、乱数部分(残り 16 文字)の代わりに連番を使う。
 * 時刻が後戻りしない限り、作った順に文字列として増えていく
 */
export class SequentialIdGenerator implements IdGenerator {
  private sequence = 0;

  generate(time: Date): MemoId {
    this.sequence += 1;
    return encode(time.getTime(), 10) + encode(this.sequence, 16);
  }
}
