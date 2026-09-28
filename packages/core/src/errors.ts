// エラーコード(SPEC 6.2)。API とフロントエンドの両方で使う
export const ERROR_CODES = [
  "INVALID_JSON",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "UNSUPPORTED_MEDIA_TYPE",
  "PRECONDITION_FAILED",
  "PRECONDITION_REQUIRED",
  "THROTTLED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// 検証エラーの理由(SPEC 6.1)
export const VALIDATION_REASONS = [
  "REQUIRED",
  "INVALID_TYPE",
  "BLANK",
  "TOO_LONG",
  "OUT_OF_RANGE",
  "INVALID_FORMAT",
  "UNKNOWN_FIELD",
  "NO_CHANGES",
] as const;

export type ValidationReason = (typeof VALIDATION_REASONS)[number];

/** field は title / body / limit / cursor / If-Match / 未定義のキーの名前。リクエスト全体に対するエラーは "" */
export type FieldError = {
  field: string;
  reason: ValidationReason;
};

export type ValidationFailed = { code: "VALIDATION_FAILED"; errors: FieldError[] };
export type NotFound = { code: "NOT_FOUND" };
export type PreconditionFailed = { code: "PRECONDITION_FAILED" };
export type Throttled = { code: "THROTTLED" };

/** ユースケースが返すエラー。それ以外の失敗(想定外の例外)はアダプター層で INTERNAL にする */
export type DomainError = ValidationFailed | NotFound | PreconditionFailed | Throttled;
