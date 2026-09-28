import {
  BODY_MAX_BYTES,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  TITLE_MAX_LENGTH,
} from "./constants";
import { decodeCursor } from "./cursor";
import type { FieldError } from "./errors";
import type { MemoId } from "./memo";
import { err, ok, type Result } from "./result";

export type CreateMemoInput = { title: string; body: string };
export type UpdateMemoInput = { title?: string; body?: string };
export type ListQuery = { limit: number; after: MemoId | undefined };

const MEMO_KEYS = new Set(["title", "body"]);

// 保存するときに前後の空白の除去や Unicode 正規化はしない(SPEC 5 章)。検証だけに使う

/** title の文字数は Unicode のコードポイント数で数える */
export function countCodePoints(value: string): number {
  return [...value].length;
}

/** body の上限は UTF-8 のバイト数で判定する */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkTitle(value: unknown): FieldError | undefined {
  if (typeof value !== "string") return { field: "title", reason: "INVALID_TYPE" };
  if (value.trim().length === 0) return { field: "title", reason: "BLANK" };
  if (countCodePoints(value) > TITLE_MAX_LENGTH) return { field: "title", reason: "TOO_LONG" };
  return undefined;
}

function checkBody(value: unknown): FieldError | undefined {
  if (typeof value !== "string") return { field: "body", reason: "INVALID_TYPE" };
  if (utf8ByteLength(value) > BODY_MAX_BYTES) return { field: "body", reason: "TOO_LONG" };
  return undefined;
}

function unknownKeys(input: Record<string, unknown>): FieldError[] {
  return Object.keys(input)
    .filter((key) => !MEMO_KEYS.has(key))
    .map((key) => ({ field: key, reason: "UNKNOWN_FIELD" }));
}

/** POST のボディ(JSON を解析した値)を検証する */
export function validateCreateMemoInput(input: unknown): Result<CreateMemoInput, FieldError[]> {
  if (!isPlainObject(input)) return err([{ field: "", reason: "INVALID_TYPE" }]);

  const errors: FieldError[] = [];
  if (!("title" in input)) {
    errors.push({ field: "title", reason: "REQUIRED" });
  } else {
    const error = checkTitle(input.title);
    if (error) errors.push(error);
  }
  if ("body" in input) {
    const error = checkBody(input.body);
    if (error) errors.push(error);
  }
  errors.push(...unknownKeys(input));

  if (errors.length > 0) return err(errors);
  return ok({ title: input.title as string, body: "body" in input ? (input.body as string) : "" });
}

/** PATCH のボディ(JSON を解析した値)を検証する。指定したキーだけを返す */
export function validateUpdateMemoInput(input: unknown): Result<UpdateMemoInput, FieldError[]> {
  if (!isPlainObject(input)) return err([{ field: "", reason: "INVALID_TYPE" }]);

  const errors: FieldError[] = [];
  const value: UpdateMemoInput = {};
  if ("title" in input) {
    const error = checkTitle(input.title);
    if (error) errors.push(error);
    else value.title = input.title as string;
  }
  if ("body" in input) {
    const error = checkBody(input.body);
    if (error) errors.push(error);
    else value.body = input.body as string;
  }
  errors.push(...unknownKeys(input));

  if (errors.length > 0) return err(errors);
  if (!("title" in value) && !("body" in value)) return err([{ field: "", reason: "NO_CHANGES" }]);
  return ok(value);
}

/** 一覧のクエリ(クエリ文字列の値そのまま)を検証する */
export function validateListQuery(query: {
  limit?: string;
  cursor?: string;
}): Result<ListQuery, FieldError[]> {
  const errors: FieldError[] = [];

  let limit = LIST_LIMIT_DEFAULT;
  if (query.limit !== undefined) {
    if (!/^-?[0-9]+$/.test(query.limit)) {
      errors.push({ field: "limit", reason: "INVALID_FORMAT" });
    } else {
      limit = Number(query.limit);
      if (limit < LIST_LIMIT_MIN || limit > LIST_LIMIT_MAX) {
        errors.push({ field: "limit", reason: "OUT_OF_RANGE" });
      }
    }
  }

  let after: MemoId | undefined;
  if (query.cursor !== undefined) {
    after = decodeCursor(query.cursor);
    if (after === undefined) errors.push({ field: "cursor", reason: "INVALID_FORMAT" });
  }

  if (errors.length > 0) return err(errors);
  return ok({ limit, after });
}
