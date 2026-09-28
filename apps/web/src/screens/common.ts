import type { ApiClient, ApiResult, EtaggedMemo } from "../api/client";
import { h } from "../ui/dom";
import { retryAvailableAt, secondsUntil } from "../ui/retry";
import type { Route } from "../ui/route";

// 画面(screens/*)が共通で使うもの。DOM を操作するので自動テストはしない(SPEC 10.4)

export type ScreenContext = {
  /** 401 のときの処理(トークンの破棄と入力画面)は app.ts が済ませてから結果を返す */
  api: ApiClient;
  /** 画面を移る。replace なら履歴に残さない */
  go(route: Exclude<Route, { name: "not_found" }>, options?: { replace?: boolean }): void;
  /** 画面を離れるときに確認を出すかどうか。画面を描き直すたびに「確認しない」に戻る */
  setLeaveGuard(isDirty: () => boolean): void;
  /** 作成直後のメモを詳細画面に渡す(もう一度 GET しないため) */
  setPreloaded(value: EtaggedMemo): void;
  takePreloaded(id: string): EtaggedMemo | undefined;
};

/** 画面を container に描く。後片付けが要れば関数を返す */
export type Screen = (container: HTMLElement, context: ScreenContext) => (() => void) | void;

export type StatusLine = {
  element: HTMLElement;
  info(message: string): void;
  success(message: string): void;
  error(message: string): void;
  clear(): void;
};

export function createStatusLine(): StatusLine {
  const element = h("p", { className: "status", hidden: true });
  element.setAttribute("role", "status");
  const set = (message: string, kind: string) => {
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = false;
  };
  return {
    element,
    info: (message) => set(message, "info"),
    success: (message) => set(message, "success"),
    error: (message) => set(message, "error"),
    clear: () => {
      element.textContent = "";
      element.hidden = true;
    },
  };
}

/**
 * API を呼ぶ。fetch 自体の失敗(ネットワーク、CORS で拒否された、ETag が読めないなど)は
 * 例外で届くので、ここで捕まえて表示し、undefined を返す
 */
export async function callApi<T>(
  status: StatusLine,
  call: () => Promise<ApiResult<T>>,
): Promise<ApiResult<T> | undefined> {
  try {
    return await call();
  } catch (error) {
    console.error(error);
    status.error("通信に失敗しました。ネットワークの状態と、API の CORS の設定を確認してください");
    return undefined;
  }
}

export type RetryGate = {
  /** 429 を受け取ったら呼ぶ。Retry-After の秒数だけ待つ */
  block(retryAfterSeconds: number | undefined): void;
  /** 待ちの残りの秒数。待っていなければ 0 */
  secondsLeft(): number;
  dispose(): void;
};

/** 429 のあと、保存ボタンを無効にしておく時間を数える(SPEC 10.3)。自動では再送しない */
export function createRetryGate(onChange: () => void): RetryGate {
  let availableAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  return {
    block(retryAfterSeconds) {
      availableAt = retryAvailableAt(Date.now(), retryAfterSeconds);
      stop();
      timer = setInterval(() => {
        if (secondsUntil(availableAt, Date.now()) === 0) stop();
        onChange();
      }, 250);
      onChange();
    },
    secondsLeft: () => secondsUntil(availableAt, Date.now()),
    dispose: stop,
  };
}
