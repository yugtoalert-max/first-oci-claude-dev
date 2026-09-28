// 認証トークンの保管(SPEC 10.3)。sessionStorage に置き、ビルド成果物には埋め込まない

export const TOKEN_STORAGE_KEY = "memo.token";

/** sessionStorage のうち使う部分。テストでは偽物を渡す */
export type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type TokenStore = {
  /** なければ null */
  get(): string | null;
  set(token: string): void;
  /** 401 が返ったときに破棄する */
  clear(): void;
};

export function createTokenStore(storage: TokenStorage): TokenStore {
  return {
    get: () => storage.getItem(TOKEN_STORAGE_KEY) || null,
    set: (token) => storage.setItem(TOKEN_STORAGE_KEY, token),
    clear: () => storage.removeItem(TOKEN_STORAGE_KEY),
  };
}

/** 入力されたトークン。前後の空白を除き、空なら undefined */
export function normalizeTokenInput(input: string): string | undefined {
  const token = input.trim();
  return token === "" ? undefined : token;
}
