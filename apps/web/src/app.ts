import { createApiClient, type ApiClient, type ApiResult, type EtaggedMemo } from "./api/client";
import type { Screen, ScreenContext } from "./screens/common";
import { detailScreen } from "./screens/detail-screen";
import { listScreen } from "./screens/list-screen";
import { newScreen } from "./screens/new-screen";
import { notFoundScreen } from "./screens/not-found-screen";
import { createTokenView } from "./screens/token-view";
import { h } from "./ui/dom";
import { parseRoute, routeHash, type Route } from "./ui/route";
import { createTokenStore, type TokenStorage } from "./ui/token-store";

// 画面の切り替え(ハッシュルーティング)、トークン、未保存のまま離れるときの確認(SPEC 10.3)

const LEAVE_MESSAGE = "保存していない変更があります。このページを離れますか?";

/** 401 が返ったら onUnauthorized を呼んでから、結果をそのまま返す */
function withUnauthorizedHandler(api: ApiClient, onUnauthorized: () => void): ApiClient {
  const check = async <T>(pending: Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
    const result = await pending;
    if (!result.ok && result.error.code === "UNAUTHORIZED") onUnauthorized();
    return result;
  };
  return {
    createMemo: (input) => check(api.createMemo(input)),
    listMemos: (query) => check(api.listMemos(query)),
    getMemo: (id) => check(api.getMemo(id)),
    updateMemo: (id, etag, patch) => check(api.updateMemo(id, etag, patch)),
    deleteMemo: (id, etag) => check(api.deleteMemo(id, etag)),
  };
}

function screenFor(route: Route): Screen {
  switch (route.name) {
    case "list":
      return listScreen;
    case "new":
      return newScreen;
    case "detail":
      return detailScreen(route.id);
    case "not_found":
      return notFoundScreen;
  }
}

export function startApp(root: HTMLElement, options: { baseUrl: string; storage: TokenStorage }): void {
  const tokens = createTokenStore(options.storage);
  const main = h("main", { hidden: true });
  const tokenView = createTokenView(submitToken);
  root.replaceChildren(tokenView.element, main);

  let disposeScreen: (() => void) | void;
  let leaveGuard: () => boolean = () => false;
  let preloaded: EtaggedMemo | undefined;
  /** 今の URL の画面を main に描いていれば true。トークンがないあいだに移動したら false */
  let rendered = false;
  let currentUrl = location.href;

  const api = withUnauthorizedHandler(
    createApiClient({ baseUrl: options.baseUrl, getToken: () => tokens.get() ?? "" }),
    onUnauthorized,
  );

  const context: ScreenContext = {
    api,
    go(route, { replace = false } = {}) {
      const hash = routeHash(route);
      if (replace) location.replace(hash);
      else location.hash = hash;
    },
    setLeaveGuard(isDirty) {
      leaveGuard = isDirty;
    },
    setPreloaded(value) {
      preloaded = value;
    },
    takePreloaded(id) {
      const value = preloaded?.memo.id === id ? preloaded : undefined;
      preloaded = undefined;
      return value;
    },
  };

  function render() {
    disposeScreen?.();
    disposeScreen = undefined;
    leaveGuard = () => false;
    if (tokens.get() === null) {
      rendered = false;
      main.hidden = true;
      main.replaceChildren();
      tokenView.show();
      return;
    }
    rendered = true;
    tokenView.hide();
    main.hidden = false;
    disposeScreen = screenFor(parseRoute(location.hash))(main, context);
  }

  // 401: トークンを破棄して入力画面を出す。入力中の画面は消さずに隠しておき、入れ直したら元に戻す
  function onUnauthorized() {
    tokens.clear();
    main.hidden = true;
    tokenView.show("トークンが正しくないか、変更されています。入力し直してください");
  }

  function submitToken(token: string) {
    tokens.set(token);
    if (rendered) {
      tokenView.hide();
      main.hidden = false;
    } else {
      render();
    }
  }

  window.addEventListener("hashchange", () => {
    if (location.href === currentUrl) return;
    if (leaveGuard() && !confirm(LEAVE_MESSAGE)) {
      // 移動を取り消す。hashchange を起こさずに URL だけ元に戻す
      history.replaceState(history.state, "", currentUrl);
      return;
    }
    currentUrl = location.href;
    render();
  });

  window.addEventListener("beforeunload", (event) => {
    if (leaveGuard()) event.preventDefault();
  });

  render();
}
