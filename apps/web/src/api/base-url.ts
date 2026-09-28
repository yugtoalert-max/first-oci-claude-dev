// API のベース URL(SPEC 10.1)。
// 本番のビルドでは相対パス /api(フロントエンドと API は同じオリジン)。
// 手元の開発では apps/web/.env の VITE_API_BASE_URL を使う

const PRODUCTION_BASE_URL = "/api";

/** import.meta.env を受け取る。テストのため import.meta.env を直接読まない */
export function resolveApiBaseUrl(env: { PROD: boolean; VITE_API_BASE_URL?: string }): string {
  // .env は本番のビルドでも読み込まれるので、値があっても使わない
  if (env.PROD) return PRODUCTION_BASE_URL;

  const value = env.VITE_API_BASE_URL?.trim();
  if (!value) {
    throw new Error(
      "VITE_API_BASE_URL is not set. Copy apps/web/.env.example to apps/web/.env and set it.",
    );
  }
  return value.replace(/\/+$/, "");
}
