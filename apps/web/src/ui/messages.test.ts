import { BODY_MAX_BYTES, TITLE_MAX_LENGTH } from "@memo/core";
import { describe, expect, it } from "vitest";
import { apiErrorMessage, fieldErrorMessage } from "./messages";

describe("fieldErrorMessage", () => {
  it("title と body のエラーを画面の文言にする", () => {
    expect(fieldErrorMessage({ field: "title", reason: "REQUIRED" })).toBe("タイトルを入力してください");
    expect(fieldErrorMessage({ field: "title", reason: "BLANK" })).toBe("タイトルを入力してください");
    expect(fieldErrorMessage({ field: "title", reason: "TOO_LONG" })).toBe(
      `タイトルは ${TITLE_MAX_LENGTH} 文字以内にしてください`,
    );
    expect(fieldErrorMessage({ field: "body", reason: "TOO_LONG" })).toBe(
      `本文は ${BODY_MAX_BYTES} バイト以内にしてください`,
    );
  });

  it("画面で想定していないエラーは field と reason をそのまま出す", () => {
    expect(fieldErrorMessage({ field: "If-Match", reason: "INVALID_FORMAT" })).toBe(
      "入力が正しくありません(If-Match: INVALID_FORMAT)",
    );
  });
});

describe("apiErrorMessage", () => {
  it("412 は他で更新されたことを伝える", () => {
    expect(apiErrorMessage({ status: 412, code: "PRECONDITION_FAILED" })).toBe(
      "他で更新されています。最新を読み込みますか?",
    );
  });

  it("429 は混み合っていることを伝える", () => {
    expect(apiErrorMessage({ status: 429, code: "THROTTLED", retryAfterSeconds: 1 })).toBe(
      "混み合っています。少し待ってからもう一度お試しください",
    );
  });

  it("404 はメモが見つからないことを伝える", () => {
    expect(apiErrorMessage({ status: 404, code: "NOT_FOUND" })).toBe(
      "メモが見つかりません。削除された可能性があります",
    );
  });

  it("401 はトークンを入れ直してから再度操作するよう伝える", () => {
    expect(apiErrorMessage({ status: 401, code: "UNAUTHORIZED" })).toBe(
      "認証に失敗しました。トークンを入力し直してから、もう一度お試しください",
    );
  });

  it("VALIDATION_FAILED は各項目の文言をつなげる", () => {
    expect(
      apiErrorMessage({
        status: 400,
        code: "VALIDATION_FAILED",
        errors: [
          { field: "title", reason: "BLANK" },
          { field: "body", reason: "TOO_LONG" },
        ],
      }),
    ).toBe(`タイトルを入力してください\n本文は ${BODY_MAX_BYTES} バイト以内にしてください`);
  });

  it("それ以外はステータスと code を出す", () => {
    expect(apiErrorMessage({ status: 502, code: "INTERNAL" })).toBe("エラーが起きました(502 INTERNAL)");
    expect(apiErrorMessage({ status: 400, code: "INVALID_JSON" })).toBe(
      "エラーが起きました(400 INVALID_JSON)",
    );
  });
});
