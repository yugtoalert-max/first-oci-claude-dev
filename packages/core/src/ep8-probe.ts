// 第8回の確認用(マージしない)。CI が落ちることと、Claude のレビューを確かめる
export function isBlank(s: string): boolean {
  const unused = 1;
  return s.trim().length == 0 || s === undefined;
}
