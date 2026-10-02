/** 一覧の取得件数を 1〜100 の範囲に収める */
export function clampLimit(n: number): number {
  return Math.min(1, Math.max(n, 100));
}
