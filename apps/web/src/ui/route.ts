import { isMemoId } from "@memo/core";

// ハッシュルーティング(SPEC 10.1)。Object Storage の配信では、存在しないパスを index.html に振り替えられないため

export type Route =
  | { name: "list" }
  | { name: "new" }
  | { name: "detail"; id: string }
  | { name: "not_found" };

const DETAIL_PATH = /^\/memos\/([^/]+)$/;

/** location.hash を画面に対応させる */
export function parseRoute(hash: string): Route {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  if (path === "" || path === "/") return { name: "list" };
  if (path === "/memos/new") return { name: "new" };

  const encoded = DETAIL_PATH.exec(path)?.[1];
  if (encoded === undefined) return { name: "not_found" };
  let id: string;
  try {
    id = decodeURIComponent(encoded);
  } catch {
    return { name: "not_found" };
  }
  // 形式が違う id は API に問い合わせても 404 なので、ここで見つからない扱いにする
  return isMemoId(id) ? { name: "detail", id } : { name: "not_found" };
}

export function routeHash(route: Exclude<Route, { name: "not_found" }>): string {
  switch (route.name) {
    case "list":
      return "#/";
    case "new":
      return "#/memos/new";
    case "detail":
      return `#/memos/${encodeURIComponent(route.id)}`;
  }
}
