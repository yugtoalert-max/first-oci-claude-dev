import { createHash, timingSafeEqual } from "node:crypto";

// スキーム名は大文字・小文字を区別しない。トークンは RFC 6750 の b64token(token68 と同じ文字)
const BEARER_PATTERN = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

/**
 * Authorization ヘッダーの値から Bearer トークンを取り出す。取り出せなければ undefined。
 * API Gateway はヘッダーが複数あると配列で渡すので、配列は(要素が 1 つでも)受け付けない
 */
export function extractBearerToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return BEARER_PATTERN.exec(value.trim())?.[1];
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * トークンが一致するか。
 * timingSafeEqual は長さが同じバッファしか比べられないので、両方をハッシュしてから比べる(長さも漏らさない)
 */
export function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(sha256(presented), sha256(expected));
}
