import { BODY_MAX_BYTES, TITLE_MAX_LENGTH, type FieldError } from "@memo/core";
import type { ApiError } from "../api/client";

// 画面に出す文言。判定は code と reason で行う(SPEC 6.1)

export function fieldErrorMessage(error: FieldError): string {
  if (error.field === "title") {
    if (error.reason === "REQUIRED" || error.reason === "BLANK") return "タイトルを入力してください";
    if (error.reason === "TOO_LONG") return `タイトルは ${TITLE_MAX_LENGTH} 文字以内にしてください`;
  }
  if (error.field === "body" && error.reason === "TOO_LONG") {
    return `本文は ${BODY_MAX_BYTES} バイト以内にしてください`;
  }
  return `入力が正しくありません(${error.field}: ${error.reason})`;
}

export function apiErrorMessage(error: ApiError): string {
  switch (error.code) {
    case "PRECONDITION_FAILED":
      return "他で更新されています。最新を読み込みますか?";
    case "THROTTLED":
      return "混み合っています。少し待ってからもう一度お試しください";
    case "UNAUTHORIZED":
      return "認証に失敗しました。トークンを入力し直してから、もう一度お試しください";
    case "NOT_FOUND":
      return "メモが見つかりません。削除された可能性があります";
    case "VALIDATION_FAILED":
      if (error.errors && error.errors.length > 0) {
        return error.errors.map(fieldErrorMessage).join("\n");
      }
      break;
  }
  return `エラーが起きました(${error.status} ${error.code})`;
}
