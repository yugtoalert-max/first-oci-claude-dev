/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 手元の開発でだけ使う API のベース URL(SPEC 10.1)。例: https://<host>/api */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
