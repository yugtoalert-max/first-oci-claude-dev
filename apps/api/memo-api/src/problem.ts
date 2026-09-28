import type { DomainError, ErrorCode, FieldError } from "@memo/core";
import type { HttpResponse } from "./http";

// SPEC 6 章: RFC 9457(application/problem+json)に code を足した形

/** UNAUTHORIZED は API Gateway と authorizer が返すので、アダプター層では使わない */
export type AdapterErrorCode = Exclude<ErrorCode, "UNAUTHORIZED">;

const PROBLEMS: Record<AdapterErrorCode, { status: number; title: string; detail: string }> = {
  INVALID_JSON: { status: 400, title: "Invalid JSON", detail: "Request body is not valid JSON." },
  VALIDATION_FAILED: { status: 400, title: "Validation failed", detail: "Request is invalid." },
  NOT_FOUND: { status: 404, title: "Not found", detail: "The resource was not found." },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    title: "Unsupported media type",
    detail: "Content-Type must be application/json.",
  },
  PRECONDITION_FAILED: {
    status: 412,
    title: "Precondition failed",
    detail: "The memo has been modified by another request.",
  },
  PRECONDITION_REQUIRED: {
    status: 428,
    title: "Precondition required",
    detail: "If-Match header is required.",
  },
  THROTTLED: { status: 429, title: "Too many requests", detail: "Please retry later." },
  INTERNAL: { status: 500, title: "Internal server error", detail: "An unexpected error occurred." },
};

/** Retry-After の秒数(SPEC 6.2) */
const RETRY_AFTER_SECONDS = "1";

/** ログに code を出すために、problem で作ったレスポンスの code を覚えておく */
const codes = new WeakMap<HttpResponse, AdapterErrorCode>();

export function problemCode(response: HttpResponse): AdapterErrorCode | undefined {
  return codes.get(response);
}

export function problem(code: AdapterErrorCode, errors?: FieldError[]): HttpResponse {
  const { status, title, detail } = PROBLEMS[code];
  const headers: Record<string, string> = {
    "Content-Type": "application/problem+json",
    "Cache-Control": "no-store",
  };
  if (code === "THROTTLED") headers["Retry-After"] = RETRY_AFTER_SECONDS;

  const body = { type: "about:blank", title, status, code, detail, ...(errors ? { errors } : {}) };
  const response = { status, headers, body: JSON.stringify(body) };
  codes.set(response, code);
  return response;
}

export function fromDomainError(error: DomainError): HttpResponse {
  return error.code === "VALIDATION_FAILED"
    ? problem(error.code, error.errors)
    : problem(error.code);
}
