import { BODY_MAX_BYTES, utf8ByteLength, validateCreateMemoInput, type FieldError } from "@memo/core";

// 新規作成と編集のフォームの計算(SPEC 10.3 の「入力の上限」「未保存のまま離れるとき」)。
// 上限は packages/core の定数と検証をそのまま使う。API 側の検証は省略しない

/** フォームに入力中の内容 */
export type MemoDraft = { title: string; body: string };

/** body の残りのバイト数(UTF-8)。上限を超えると負の数 */
export function remainingBodyBytes(body: string): number {
  return BODY_MAX_BYTES - utf8ByteLength(body);
}

/** 送る前の検証。API と同じ規則(core の検証)を使う */
export function checkDraft(draft: MemoDraft): FieldError[] {
  const result = validateCreateMemoInput({ title: draft.title, body: draft.body });
  return result.ok ? [] : result.error;
}

/** 保存済みの内容から変わっていれば true */
export function isDirty(saved: MemoDraft, draft: MemoDraft): boolean {
  return saved.title !== draft.title || saved.body !== draft.body;
}

/** PATCH のボディ。変わったキーだけを入れる。変わっていなければ undefined */
export function buildPatch(
  saved: MemoDraft,
  draft: MemoDraft,
): { title?: string; body?: string } | undefined {
  const patch: { title?: string; body?: string } = {};
  if (draft.title !== saved.title) patch.title = draft.title;
  if (draft.body !== saved.body) patch.body = draft.body;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/** 412 のときに、最新を読み込む前に入力中の内容をコピーするための文字列 */
export function draftToClipboardText(draft: MemoDraft): string {
  return `${draft.title}\n\n${draft.body}`;
}
