// 入力の上限(SPEC 5 章)。API とフロントエンドの両方で使う

/** title の最大文字数(Unicode のコードポイント数) */
export const TITLE_MAX_LENGTH = 200;

/** body の最大サイズ(UTF-8 のバイト数)。16KB */
export const BODY_MAX_BYTES = 16_384;

// 一覧の件数(SPEC 4.3 GET /api/memos)
export const LIST_LIMIT_MIN = 1;
export const LIST_LIMIT_MAX = 50;
export const LIST_LIMIT_DEFAULT = 20;
