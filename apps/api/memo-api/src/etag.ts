import type { Version } from "@memo/core";

// SPEC 3.4: バージョン文字列をダブルクォートで囲んだ強い ETag。W/ は付けない

export type IfMatch = { kind: "absent" } | { kind: "invalid" } | { kind: "version"; version: Version };

// 強い ETag 1 つだけを受け付ける。中身は RFC 9110 の etagc(%x21 / %x23-7E)で、空は受け付けない。
// *・複数の値・W/ 付きはこの形に合わないので invalid になる
const STRONG_ETAG = /^"([\x21\x23-\x7E]+)"$/;

export function toEtag(version: Version): string {
  return `"${version}"`;
}

/** If-Match ヘッダーの値を解釈する。ヘッダーが複数行で届いたら invalid */
export function parseIfMatch(value: string | string[] | undefined): IfMatch {
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "absent" };
    if (value.length > 1) return { kind: "invalid" };
    value = value[0];
  }
  if (value === undefined) return { kind: "absent" };

  const match = STRONG_ETAG.exec(value.trim());
  if (!match?.[1]) return { kind: "invalid" };
  return { kind: "version", version: match[1] };
}
