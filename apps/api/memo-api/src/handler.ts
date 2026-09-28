import {
  createMemo,
  deleteMemo,
  getMemo,
  isMemoId,
  listMemos,
  updateMemo,
  type Clock,
  type IdGenerator,
  type MemoRepository,
} from "@memo/core";
import { parseIfMatch, toEtag } from "./etag";
import type { HttpHeaders, HttpRequest, HttpResponse } from "./http";
import { fromDomainError, problem, problemCode } from "./problem";
import { toMemoJson, toPageJson } from "./representation";

export type HandlerDeps = {
  repository: MemoRepository;
  clock: Clock;
  idGenerator: IdGenerator;
  /** ログを 1 行書く。実行環境では標準出力に書く */
  log: (line: string) => void;
  /** 所要時間の計測に使う単調増加の時刻(ms)。実行環境では performance.now など */
  timer: () => number;
};

type Handler = (request: HttpRequest) => Promise<HttpResponse>;

/** ログに出すルートのテンプレート(SPEC 9.4) */
type RouteTemplate = "/api/memos" | "/api/memos/{id}";

const COLLECTION_PATH = "/api/memos";
const ITEM_PATH = /^\/api\/memos\/([^/]+)$/;

function header(headers: HttpHeaders, name: string): string | string[] | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** application/json(charset などのパラメーター付きも可)なら true。ヘッダーが複数行なら false */
function isJsonContentType(value: string | string[] | undefined): boolean {
  const single = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
  if (single === undefined) return false;
  return single.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

/** SPEC 4.4 の 4〜5: Content-Type → JSON の解析 */
function readJsonBody(
  request: HttpRequest,
): { ok: true; value: unknown } | { ok: false; response: HttpResponse } {
  if (!isJsonContentType(header(request.headers, "Content-Type"))) {
    return { ok: false, response: problem("UNSUPPORTED_MEDIA_TYPE") };
  }
  try {
    return { ok: true, value: JSON.parse(request.body) };
  } catch {
    return { ok: false, response: problem("INVALID_JSON") };
  }
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

/**
 * HTTP のリクエストを受け取り、ルーティングしてユースケースを呼び、HTTP のレスポンスに変換する。
 * FDK には依存しない
 */
export function createHandler(deps: HandlerDeps): Handler {
  async function create(request: HttpRequest): Promise<HttpResponse> {
    const body = readJsonBody(request);
    if (!body.ok) return body.response;

    const result = await createMemo(deps, body.value);
    if (!result.ok) return fromDomainError(result.error);
    const { memo, version } = result.value;
    return json(201, toMemoJson(memo), {
      Location: `${COLLECTION_PATH}/${memo.id}`,
      ETag: toEtag(version),
    });
  }

  async function list(query: URLSearchParams): Promise<HttpResponse> {
    const result = await listMemos(deps, {
      limit: query.get("limit") ?? undefined,
      cursor: query.get("cursor") ?? undefined,
    });
    if (!result.ok) return fromDomainError(result.error);
    return json(200, toPageJson(result.value));
  }

  async function get(id: string): Promise<HttpResponse> {
    const result = await getMemo(deps, id);
    if (!result.ok) return fromDomainError(result.error);
    return json(200, toMemoJson(result.value.memo), { ETag: toEtag(result.value.version) });
  }

  async function update(id: string, request: HttpRequest): Promise<HttpResponse> {
    const ifMatch = parseIfMatch(header(request.headers, "If-Match"));
    if (ifMatch.kind === "absent") return problem("PRECONDITION_REQUIRED");
    if (ifMatch.kind === "invalid") {
      return problem("VALIDATION_FAILED", [{ field: "If-Match", reason: "INVALID_FORMAT" }]);
    }

    const body = readJsonBody(request);
    if (!body.ok) return body.response;

    const result = await updateMemo(deps, {
      id,
      input: body.value,
      expectedVersion: ifMatch.version,
    });
    if (!result.ok) return fromDomainError(result.error);
    return json(200, toMemoJson(result.value.memo), { ETag: toEtag(result.value.version) });
  }

  async function remove(id: string, request: HttpRequest): Promise<HttpResponse> {
    const ifMatch = parseIfMatch(header(request.headers, "If-Match"));
    if (ifMatch.kind === "invalid") {
      return problem("VALIDATION_FAILED", [{ field: "If-Match", reason: "INVALID_FORMAT" }]);
    }

    const result = await deleteMemo(deps, {
      id,
      expectedVersion: ifMatch.kind === "version" ? ifMatch.version : undefined,
    });
    if (!result.ok) return fromDomainError(result.error);
    return { status: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  }

  /** ルートが決まればテンプレートと処理を返す。定義していないルートは undefined */
  function route(
    request: HttpRequest,
    path: string,
    query: URLSearchParams,
  ): { template: RouteTemplate; run: () => Promise<HttpResponse> } | undefined {
    if (path === COLLECTION_PATH) {
      const template = "/api/memos";
      if (request.method === "POST") return { template, run: () => create(request) };
      if (request.method === "GET") return { template, run: () => list(query) };
      return undefined;
    }

    const id = ITEM_PATH.exec(path)?.[1];
    if (id === undefined) return undefined;
    let next: (() => Promise<HttpResponse>) | undefined;
    if (request.method === "GET") next = () => get(id);
    else if (request.method === "PATCH") next = () => update(id, request);
    else if (request.method === "DELETE") next = () => remove(id, request);
    if (next === undefined) return undefined;
    const handle = next;
    return {
      template: "/api/memos/{id}",
      // SPEC 4.4 の 2: パスの id の形式は、ヘッダーやボディより先に判定する
      run: async () => (isMemoId(id) ? handle() : problem("NOT_FOUND")),
    };
  }

  return async (request) => {
    const startedAt = deps.timer();
    const queryStart = request.url.indexOf("?");
    const path = queryStart === -1 ? request.url : request.url.slice(0, queryStart);
    const query = new URLSearchParams(queryStart === -1 ? "" : request.url.slice(queryStart + 1));

    const matched = route(request, path, query);
    let response: HttpResponse;
    let error: unknown;
    let failed = false;
    try {
      response = matched ? await matched.run() : problem("NOT_FOUND");
    } catch (thrown) {
      // スロットリング以外の失敗は例外で届く。内部の詳細はレスポンスに含めず、ログにだけ出す
      response = problem("INTERNAL");
      error = thrown;
      failed = true;
    }

    // SPEC 9.4: title・body・トークン・Authorization ヘッダーは出さない
    const entry: Record<string, unknown> = {
      requestId: request.requestId,
      method: request.method,
      route: matched?.template ?? null,
      status: response.status,
      durationMs: deps.timer() - startedAt,
    };
    const code = problemCode(response);
    if (code !== undefined) entry.code = code;
    if (failed) entry.error = describeError(error);
    deps.log(JSON.stringify(entry));

    return response;
  };
}
