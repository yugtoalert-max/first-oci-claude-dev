import {
  ERROR_CODES,
  err,
  ok,
  type ErrorCode,
  type FieldError,
  type Memo,
  type MemoPage,
  type MemoSummary,
  type Result,
} from "@memo/core";

// API クライアント層(SPEC 10.4)。fetch を包み、HTTP の結果を Result に変換する。
// 画面の状態(トークンの保管、ETag を持つ画面、429 の待ち時間)は持たない

/** fetch の差し替え口。テストでは偽物を渡す */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  /** 例: /api(本番)、https://<host>/api(手元の開発)。base-url.ts で決める */
  baseUrl: string;
  /** リクエストのたびに呼ぶ。トークンの保管は呼び出し側(UI)の責務 */
  getToken: () => string;
  fetch?: FetchLike;
};

export type ApiError = {
  status: number;
  code: ErrorCode;
  /** VALIDATION_FAILED のときだけ */
  errors?: FieldError[];
  /** Retry-After を秒数として読めたときだけ */
  retryAfterSeconds?: number;
};

export type ApiResult<T> = Result<T, ApiError>;

/** メモと、その ETag(ダブルクォート付きのヘッダーの値のまま)。ETag は PATCH / DELETE の If-Match に使う */
export type EtaggedMemo = { memo: Memo; etag: string };

export type ApiClient = {
  createMemo(input: { title: string; body?: string }): Promise<ApiResult<EtaggedMemo>>;
  listMemos(query?: { cursor?: string; limit?: number }): Promise<ApiResult<MemoPage>>;
  getMemo(id: string): Promise<ApiResult<EtaggedMemo>>;
  updateMemo(
    id: string,
    etag: string,
    patch: { title?: string; body?: string },
  ): Promise<ApiResult<EtaggedMemo>>;
  deleteMemo(id: string, etag?: string): Promise<ApiResult<void>>;
};

type MemoJson = { id: string; title: string; body: string; createdAt: string; updatedAt: string };
type SummaryJson = Omit<MemoJson, "body">;
type PageJson = { items: SummaryJson[]; nextCursor: string | null };

/** problem+json でない、または知らない code のときに、ステータスから決める code */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  401: "UNAUTHORIZED",
  404: "NOT_FOUND",
  412: "PRECONDITION_FAILED",
  415: "UNSUPPORTED_MEDIA_TYPE",
  428: "PRECONDITION_REQUIRED",
  429: "THROTTLED",
};

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

function mediaType(response: Response): string | undefined {
  return response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
}

/** Retry-After の秒数(SPEC 6.2 では秒数で返す)。0 以上の整数だけを読み、HTTP-date は扱わない */
function parseRetryAfter(value: string | null): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

async function toApiError(response: Response): Promise<ApiError> {
  const { status } = response;
  let code: ErrorCode | undefined;
  let errors: FieldError[] | undefined;

  // 401 は API Gateway が返すのでボディの形式は保証されない。ステータスだけで判定する(SPEC 6.2)
  if (status !== 401 && mediaType(response) === "application/problem+json") {
    const body = (await response.json()) as { code?: unknown; errors?: unknown };
    if (isErrorCode(body.code)) {
      code = body.code;
      if (code === "VALIDATION_FAILED" && Array.isArray(body.errors)) {
        errors = body.errors as FieldError[];
      }
    }
  }
  code ??= CODE_BY_STATUS[status] ?? "INTERNAL";

  const error: ApiError = { status, code };
  if (errors) error.errors = errors;
  const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
  if (retryAfterSeconds !== undefined) error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function toMemo(json: MemoJson): Memo {
  return {
    id: json.id,
    title: json.title,
    body: json.body,
    createdAt: new Date(json.createdAt),
    updatedAt: new Date(json.updatedAt),
  };
}

function toSummary(json: SummaryJson): MemoSummary {
  return {
    id: json.id,
    title: json.title,
    createdAt: new Date(json.createdAt),
    updatedAt: new Date(json.updatedAt),
  };
}

async function toEtaggedMemo(response: Response): Promise<EtaggedMemo> {
  const etag = response.headers.get("ETag");
  // ETag がないと更新も削除もできない。CORS で ETag を公開していない(SPEC 8 章)などの設定の誤りなので例外にする
  if (etag === null) throw new Error(`ETag header is missing or not exposed (status ${response.status})`);
  return { memo: toMemo((await response.json()) as MemoJson), etag };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  // ブラウザの fetch は window 以外を this にして呼ぶと失敗するので、メソッドとして持たずに包む
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  async function send(
    method: string,
    path: string,
    extra: { body?: unknown; ifMatch?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${options.getToken()}` };
    const init: RequestInit = { method, headers };
    if (extra.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(extra.body);
    }
    if (extra.ifMatch !== undefined) headers["If-Match"] = extra.ifMatch;
    return doFetch(`${baseUrl}${path}`, init);
  }

  const memoPath = (id: string) => `/memos/${encodeURIComponent(id)}`;

  return {
    async createMemo(input) {
      const response = await send("POST", "/memos", { body: input });
      return response.ok ? ok(await toEtaggedMemo(response)) : err(await toApiError(response));
    },

    async listMemos(query = {}) {
      const params = new URLSearchParams();
      // カーソルは中身を解釈せず、受け取った文字列をそのまま渡す(SPEC 4.3)
      if (query.cursor !== undefined) params.set("cursor", query.cursor);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      const search = params.size > 0 ? `?${params}` : "";

      const response = await send("GET", `/memos${search}`);
      if (!response.ok) return err(await toApiError(response));
      const page = (await response.json()) as PageJson;
      return ok({ items: page.items.map(toSummary), nextCursor: page.nextCursor });
    },

    async getMemo(id) {
      const response = await send("GET", memoPath(id));
      return response.ok ? ok(await toEtaggedMemo(response)) : err(await toApiError(response));
    },

    async updateMemo(id, etag, patch) {
      const response = await send("PATCH", memoPath(id), { body: patch, ifMatch: etag });
      return response.ok ? ok(await toEtaggedMemo(response)) : err(await toApiError(response));
    },

    async deleteMemo(id, etag) {
      const response = await send("DELETE", memoPath(id), etag === undefined ? {} : { ifMatch: etag });
      return response.ok ? ok(undefined) : err(await toApiError(response));
    },
  };
}
