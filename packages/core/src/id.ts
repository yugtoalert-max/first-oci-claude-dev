import type { MemoId } from "./memo";

// 小文字は受け付けない(SPEC 3.2)
const MEMO_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isMemoId(value: string): value is MemoId {
  return MEMO_ID_PATTERN.test(value);
}
