// 429 のあと、保存ボタンを無効にしておく時間(SPEC 10.3)。自動では再送しない

/** Retry-After がない(または秒数として読めない)ときに待つ秒数 */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** 保存ボタンを有効に戻してよい時刻(エポックミリ秒) */
export function retryAvailableAt(nowMs: number, retryAfterSeconds: number | undefined): number {
  return nowMs + (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1_000;
}

/** availableAtMs までの残りの秒数(切り上げ)。過ぎていれば 0 */
export function secondsUntil(availableAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((availableAtMs - nowMs) / 1_000));
}
