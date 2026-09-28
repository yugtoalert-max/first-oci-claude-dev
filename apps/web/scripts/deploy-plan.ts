// 静的ファイルの配置の計画(SPEC 10.6)。OCI CLI を呼ぶ部分から切り離した純粋な計算

export type Upload = { name: string; contentType: string; cacheControl: string };

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  map: "application/json",
  json: "application/json",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
};

const INDEX_HTML = "index.html";
const ASSETS_PREFIX = "assets/";

/** オブジェクト名(dist/ からの相対パス。区切りは /)の拡張子から Content-Type を決める */
export function contentTypeFor(name: string): string {
  const basename = name.slice(name.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  const extension = dot === -1 ? "" : basename.slice(dot + 1).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  // 間違った Content-Type だとブラウザが読み込めないので、推測せずに止める
  if (contentType === undefined) {
    throw new Error(`Content-Type is unknown for ${name}. Add the extension to CONTENT_TYPES.`);
  }
  return contentType;
}

/** index.html は毎回確かめさせ、ハッシュ付きの assets/* は長期にキャッシュさせる */
export function cacheControlFor(name: string): string {
  if (name.startsWith(ASSETS_PREFIX)) return "public, max-age=31536000, immutable";
  // index.html と、public/ から来るハッシュなしのファイル
  return "no-cache";
}

function uploadGroup(name: string): number {
  if (name.startsWith(ASSETS_PREFIX)) return 0;
  if (name === INDEX_HTML) return 2;
  return 1;
}

/**
 * アップロードの順序: assets/* → その他 → index.html。
 * 新しい index.html が参照するファイルを先に置き、古い index.html が消えたファイルを参照する時間をなくす
 */
export function planUploads(names: readonly string[]): Upload[] {
  if (!names.includes(INDEX_HTML)) {
    throw new Error(`${INDEX_HTML} is not in the build output. Run the build first.`);
  }
  return [...names]
    .sort((a, b) => uploadGroup(a) - uploadGroup(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name, contentType: contentTypeFor(name), cacheControl: cacheControlFor(name) }));
}

/** バケットにあって dist/ にないオブジェクト。アップロードがすべて終わってから消す */
export function planDeletions(remoteNames: readonly string[], localNames: readonly string[]): string[] {
  const local = new Set(localNames);
  return remoteNames.filter((name) => !local.has(name)).sort();
}
