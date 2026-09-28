import { isMemoId } from "./id";
import type { MemoId } from "./memo";

// カーソルの形式: base64url(JSON.stringify({ v: 1, after })) (SPEC 4.3)
// 中身は ASCII だけなので btoa / atob で足りる

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function encodeCursor(after: MemoId): string {
  const json = JSON.stringify({ v: 1, after });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 復号できない、または after が ULID の形式でなければ undefined */
export function decodeCursor(cursor: string): MemoId | undefined {
  if (!BASE64URL_PATTERN.test(cursor)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const { v, after } = parsed as Record<string, unknown>;
  if (v !== 1 || typeof after !== "string" || !isMemoId(after)) return undefined;
  return after;
}
