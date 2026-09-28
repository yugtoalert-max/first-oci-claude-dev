import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "./client";

const BASE_URL = "https://api.example.test/api";
const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";
const ISO = "2026-09-28T01:23:45.678Z";
const MEMO_JSON = { id: ID, title: "買い物", body: "牛乳\n卵", createdAt: ISO, updatedAt: ISO };
const MEMO = { id: ID, title: "買い物", body: "牛乳\n卵", createdAt: new Date(ISO), updatedAt: new Date(ISO) };

type Call = { url: string; method: string; headers: Headers; body: string | undefined };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function problemResponse(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ type: "about:blank", title: "t", status, code, detail: "d", ...extra }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

/** 呼び出しを記録し、決まったレスポンスを返す偽物の fetch */
function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

function setup(respond: (call: Call) => Response, token = "token-1") {
  const fake = fakeFetch(respond);
  let current = token;
  const client = createApiClient({ baseUrl: BASE_URL, getToken: () => current, fetch: fake.fetch });
  return { client, calls: fake.calls, setToken: (next: string) => (current = next) };
}

function onlyCall(calls: Call[]): Call {
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

describe("共通", () => {
  it("すべてのリクエストに Authorization: Bearer を付け、トークンは呼ぶたびに取り直す", async () => {
    const { client, calls, setToken } = setup(() => jsonResponse(200, { items: [], nextCursor: null }));

    await client.listMemos();
    setToken("token-2");
    await client.listMemos();

    expect(calls.map((c) => c.headers.get("Authorization"))).toEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  it("ベース URL の末尾に / があっても二重にしない", async () => {
    const fake = fakeFetch(() => jsonResponse(200, { items: [], nextCursor: null }));
    const client = createApiClient({ baseUrl: "/api/", getToken: () => "t", fetch: fake.fetch });

    await client.listMemos();

    expect(onlyCall(fake.calls).url).toBe("/api/memos");
  });

  it("fetch 自体が失敗したら(ネットワークエラーなど)例外をそのまま投げる", async () => {
    const client = createApiClient({
      baseUrl: BASE_URL,
      getToken: () => "t",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(client.getMemo(ID)).rejects.toThrow("Failed to fetch");
  });
});

describe("createMemo", () => {
  it("POST /memos に JSON を送り、メモ(時刻は Date)と ETag を返す", async () => {
    const { client, calls } = setup(() =>
      jsonResponse(201, MEMO_JSON, { ETag: '"v1"', Location: `/api/memos/${ID}` }),
    );

    const result = await client.createMemo({ title: "買い物", body: "牛乳\n卵" });

    expect(result).toEqual({ ok: true, value: { memo: MEMO, etag: '"v1"' } });
    const call = onlyCall(calls);
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${BASE_URL}/memos`);
    expect(call.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call.body!)).toEqual({ title: "買い物", body: "牛乳\n卵" });
  });
});

describe("getMemo", () => {
  it("GET /memos/{id} で、メモと ETag を返す", async () => {
    const { client, calls } = setup(() => jsonResponse(200, MEMO_JSON, { ETag: '"v1"' }));

    const result = await client.getMemo(ID);

    expect(result).toEqual({ ok: true, value: { memo: MEMO, etag: '"v1"' } });
    const call = onlyCall(calls);
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${BASE_URL}/memos/${ID}`);
    expect(call.headers.get("If-Match")).toBeNull();
    expect(call.body).toBeUndefined();
  });

  it("id はパスの 1 区間としてエンコードする", async () => {
    const { client, calls } = setup(() => problemResponse(404, "NOT_FOUND"));

    await client.getMemo("a/b?c");

    expect(onlyCall(calls).url).toBe(`${BASE_URL}/memos/a%2Fb%3Fc`);
  });

  it("成功したのに ETag が読めない(CORS で公開されていないなど)なら例外を投げる", async () => {
    const { client } = setup(() => jsonResponse(200, MEMO_JSON));

    await expect(client.getMemo(ID)).rejects.toThrow(/ETag/);
  });
});

describe("updateMemo", () => {
  it("PATCH に If-Match として保持している ETag をそのまま付け、新しい ETag を返す", async () => {
    const { client, calls } = setup(() =>
      jsonResponse(200, { ...MEMO_JSON, title: "夕飯" }, { ETag: '"v2"' }),
    );

    const result = await client.updateMemo(ID, '"v1"', { title: "夕飯" });

    expect(result).toEqual({ ok: true, value: { memo: { ...MEMO, title: "夕飯" }, etag: '"v2"' } });
    const call = onlyCall(calls);
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`${BASE_URL}/memos/${ID}`);
    expect(call.headers.get("If-Match")).toBe('"v1"');
    expect(call.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call.body!)).toEqual({ title: "夕飯" });
  });

  it("412 は PRECONDITION_FAILED を返す", async () => {
    const { client } = setup(() => problemResponse(412, "PRECONDITION_FAILED"));

    const result = await client.updateMemo(ID, '"old"', { title: "夕飯" });

    expect(result).toEqual({ ok: false, error: { status: 412, code: "PRECONDITION_FAILED" } });
  });
});

describe("deleteMemo", () => {
  it("ETag を渡せば If-Match を付けて DELETE し、204 なら成功", async () => {
    const { client, calls } = setup(() => new Response(null, { status: 204 }));

    const result = await client.deleteMemo(ID, '"v1"');

    expect(result).toEqual({ ok: true, value: undefined });
    const call = onlyCall(calls);
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`${BASE_URL}/memos/${ID}`);
    expect(call.headers.get("If-Match")).toBe('"v1"');
  });

  it("ETag を渡さなければ If-Match を付けない", async () => {
    const { client, calls } = setup(() => new Response(null, { status: 204 }));

    await client.deleteMemo(ID);

    expect(onlyCall(calls).headers.get("If-Match")).toBeNull();
  });
});

describe("listMemos", () => {
  const SUMMARY_JSON = { id: ID, title: "買い物", createdAt: ISO, updatedAt: ISO };
  const SUMMARY = { id: ID, title: "買い物", createdAt: new Date(ISO), updatedAt: new Date(ISO) };

  it("引数がなければクエリを付けず、要約(時刻は Date)と nextCursor をそのまま返す", async () => {
    const { client, calls } = setup(() =>
      jsonResponse(200, { items: [SUMMARY_JSON], nextCursor: "opaque-cursor" }),
    );

    const result = await client.listMemos();

    expect(result).toEqual({ ok: true, value: { items: [SUMMARY], nextCursor: "opaque-cursor" } });
    expect(onlyCall(calls).url).toBe(`${BASE_URL}/memos`);
  });

  it("最後のページの nextCursor(null)をそのまま返す", async () => {
    const { client } = setup(() => jsonResponse(200, { items: [], nextCursor: null }));

    const result = await client.listMemos();

    expect(result).toEqual({ ok: true, value: { items: [], nextCursor: null } });
  });

  it("受け取ったカーソルを解釈せずに cursor クエリとして渡し、limit も渡す", async () => {
    const { client, calls } = setup(() => jsonResponse(200, { items: [], nextCursor: null }));

    await client.listMemos({ cursor: "a+b/c=", limit: 5 });

    const url = new URL(onlyCall(calls).url);
    expect(url.origin + url.pathname).toBe(`${BASE_URL}/memos`);
    expect(url.searchParams.get("cursor")).toBe("a+b/c=");
    expect(url.searchParams.get("limit")).toBe("5");
  });
});

describe("エラーの変換", () => {
  it("problem+json の code と status を返す", async () => {
    const { client } = setup(() => problemResponse(404, "NOT_FOUND"));

    const result = await client.getMemo(ID);

    expect(result).toEqual({ ok: false, error: { status: 404, code: "NOT_FOUND" } });
  });

  it("VALIDATION_FAILED では errors も返す", async () => {
    const errors = [{ field: "title", reason: "TOO_LONG" }];
    const { client } = setup(() => problemResponse(400, "VALIDATION_FAILED", { errors }));

    const result = await client.createMemo({ title: "x" });

    expect(result).toEqual({ ok: false, error: { status: 400, code: "VALIDATION_FAILED", errors } });
  });

  it("charset 付きの application/problem+json も読む", async () => {
    const { client } = setup(
      () =>
        new Response(JSON.stringify({ status: 400, code: "INVALID_JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/problem+json; charset=utf-8" },
        }),
    );

    const result = await client.createMemo({ title: "x" });

    expect(result).toEqual({ ok: false, error: { status: 400, code: "INVALID_JSON" } });
  });

  it.each([
    ["ボディなし", () => new Response(null, { status: 401 })],
    [
      "JSON だが problem+json ではない(API Gateway の既定の応答)",
      () => jsonResponse(401, { message: "Unauthorized" }),
    ],
    [
      "テキスト",
      () => new Response("Unauthorized", { status: 401, headers: { "Content-Type": "text/plain" } }),
    ],
    ["problem+json で別の code", () => problemResponse(401, "INTERNAL")],
  ])("401 はボディにかかわらず UNAUTHORIZED(%s)", async (_label, respond) => {
    const { client } = setup(respond);

    const result = await client.listMemos();

    expect(result).toEqual({ ok: false, error: { status: 401, code: "UNAUTHORIZED" } });
  });

  it("problem+json でない 404(API Gateway の未定義ルート)はステータスから NOT_FOUND にする", async () => {
    const { client } = setup(
      () => new Response("<html>Not Found</html>", { status: 404, headers: { "Content-Type": "text/html" } }),
    );

    const result = await client.getMemo(ID);

    expect(result).toEqual({ ok: false, error: { status: 404, code: "NOT_FOUND" } });
  });

  it("problem+json でも知らない code ならステータスから決める", async () => {
    const { client } = setup(() => problemResponse(412, "SOMETHING_NEW"));

    const result = await client.updateMemo(ID, '"v1"', { title: "x" });

    expect(result).toEqual({ ok: false, error: { status: 412, code: "PRECONDITION_FAILED" } });
  });

  it("ステータスからも決められない失敗(502 など)は INTERNAL にする", async () => {
    const { client } = setup(
      () => new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/plain" } }),
    );

    const result = await client.listMemos();

    expect(result).toEqual({ ok: false, error: { status: 502, code: "INTERNAL" } });
  });
});

describe("Retry-After(429)", () => {
  it("秒数を retryAfterSeconds として返す", async () => {
    const { client } = setup(() => problemResponse(429, "THROTTLED", {}, { "Retry-After": "1" }));

    const result = await client.updateMemo(ID, '"v1"', { title: "x" });

    expect(result).toEqual({
      ok: false,
      error: { status: 429, code: "THROTTLED", retryAfterSeconds: 1 },
    });
  });

  it("problem+json でない 429 でも THROTTLED と秒数を返す", async () => {
    const { client } = setup(() => new Response(null, { status: 429, headers: { "Retry-After": "5" } }));

    const result = await client.listMemos();

    expect(result).toEqual({
      ok: false,
      error: { status: 429, code: "THROTTLED", retryAfterSeconds: 5 },
    });
  });

  it("前後の空白は無視する", async () => {
    const { client } = setup(() => problemResponse(429, "THROTTLED", {}, { "Retry-After": " 3 " }));

    const result = await client.listMemos();

    expect(result).toMatchObject({ ok: false, error: { retryAfterSeconds: 3 } });
  });

  it.each([
    ["ヘッダーなし", undefined],
    ["小数", "1.5"],
    ["負の数", "-1"],
    ["数字でない", "soon"],
    ["HTTP-date", "Wed, 21 Oct 2026 07:28:00 GMT"],
    ["空", ""],
  ])("秒数として読めなければ retryAfterSeconds を付けない(%s)", async (_label, value) => {
    const headers: Record<string, string> = value === undefined ? {} : { "Retry-After": value };
    const { client } = setup(() => problemResponse(429, "THROTTLED", {}, headers));

    const result = await client.listMemos();

    expect(result).toEqual({ ok: false, error: { status: 429, code: "THROTTLED" } });
  });
});
