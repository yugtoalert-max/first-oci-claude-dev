import { InMemoryMemoRepository, ManualClock, SequentialIdGenerator } from "@memo/core/testing";
import { describe, expect, it } from "vitest";
import { createHandler } from "../handler";
import { NOW } from "../test-support";
import {
  createFdkHandler,
  type FdkContext,
  type FdkHttpGateway,
  toHttpRequest,
  writeHttpResponse,
} from "./fdk-bridge";

// FDK は使わず、FDK の Context と同じ形の偽物で確かめる

type FakeGateway = FdkHttpGateway & { responseHeaders: Record<string, string[]> };

function fakeContext(
  options: {
    callID?: string | null;
    requestURL?: string | null;
    method?: string | null;
    /** httpGateway.headers(Fn-Http-H- 付きで届いたヘッダー) */
    headers?: Record<string, string[]>;
    /** ctx.headers(呼び出しそのもののヘッダー) */
    invocationHeaders?: Record<string, string[]>;
  } = {},
): FdkContext & { httpGateway: FakeGateway } {
  const responseHeaders: Record<string, string[]> = {};
  const httpGateway: FakeGateway = {
    requestURL: options.requestURL === undefined ? "/api/memos" : options.requestURL,
    method: options.method === undefined ? "GET" : options.method,
    headers: options.headers ?? {},
    statusCode: null,
    setResponseHeader(key, ...values) {
      responseHeaders[key] = values;
    },
    responseHeaders,
  };
  return {
    callID: options.callID === undefined ? "call-1" : options.callID,
    headers: options.invocationHeaders ?? {},
    httpGateway,
  };
}

/**
 * FDK が応答のボディに書き出す内容。FDK は rawResult などの結果を writeResult で書き出す
 * (それ以外の値は、応答の Content-Type が JSON なら JSON.stringify してから書き出す)
 */
function writtenBody(result: unknown): string {
  if (typeof result !== "object" || result === null || !("writeResult" in result)) {
    throw new Error("not an FDK result such as rawResult");
  }
  const chunks: string[] = [];
  (result.writeResult as (ctx: unknown, resp: { write(chunk: string): boolean }) => void)(
    {},
    {
      write(chunk) {
        chunks.push(chunk);
        return true;
      },
    },
  );
  return chunks.join("");
}

describe("toHttpRequest", () => {
  it("メソッド・URL・ヘッダー・ボディと、リクエスト ID(FDK の呼び出し ID)を取り出す", () => {
    const ctx = fakeContext({
      callID: "01ABCDEF",
      requestURL: "/api/memos?limit=2",
      method: "POST",
      headers: { "Content-Type": ["application/json"], "If-Match": ['"a"', '"b"'] },
    });

    expect(toHttpRequest('{"title":"t"}', ctx)).toEqual({
      requestId: "01ABCDEF",
      method: "POST",
      url: "/api/memos?limit=2",
      headers: { "Content-Type": ["application/json"], "If-Match": ['"a"', '"b"'] },
      body: '{"title":"t"}',
    });
  });

  it("URL がスキームとホスト付きで届いたら、パスとクエリ文字列だけにする", () => {
    const ctx = fakeContext({ requestURL: "https://example.com/api/memos?limit=2&cursor=x" });

    expect(toHttpRequest("", ctx).url).toBe("/api/memos?limit=2&cursor=x");
  });

  it("呼び出しそのもののヘッダー(Content-Type など Fn-Http-H- が付かずに届くもの)も渡す", () => {
    const ctx = fakeContext({
      method: "PATCH",
      headers: { Authorization: ["Bearer x"] },
      invocationHeaders: { "Content-Type": ["application/json"], "If-Match": ['"a"'] },
    });

    expect(toHttpRequest("{}", ctx).headers).toEqual({
      Authorization: ["Bearer x"],
      "Content-Type": ["application/json"],
      "If-Match": ['"a"'],
    });
  });

  it("呼び出しそのもののヘッダーのうち、Fn- で始まる内部用のものは渡さない", () => {
    const ctx = fakeContext({
      invocationHeaders: {
        "Fn-Call-Id": ["call-1"],
        "Fn-Deadline": ["2026-09-28T00:00:00Z"],
        "Fn-Http-Method": ["GET"],
        "Fn-Http-Request-Url": ["/api/memos"],
        "Fn-Http-H-Authorization": ["Bearer x"],
        Accept: ["application/json"],
      },
    });

    expect(toHttpRequest("", ctx).headers).toEqual({ Accept: ["application/json"] });
  });

  it("同じ名前のヘッダーが両方にあれば、httpGateway 側を使う", () => {
    const ctx = fakeContext({
      headers: { "Content-Type": ["text/plain"] },
      invocationHeaders: { "Content-Type": ["application/json"] },
    });

    expect(toHttpRequest("", ctx).headers).toEqual({ "Content-Type": ["text/plain"] });
  });

  it.each([
    ["メソッド", { method: null }],
    ["URL", { requestURL: null }],
    ["呼び出し ID", { callID: null }],
  ])("HTTP Gateway 経由でない呼び出し(%s がない)は例外を投げる", (_label, options) => {
    expect(() => toHttpRequest("", fakeContext(options))).toThrow();
  });
});

describe("writeHttpResponse", () => {
  it("ステータスとヘッダーを設定し、ボディを返す", () => {
    const { httpGateway } = fakeContext();

    const body = writeHttpResponse(
      {
        status: 201,
        headers: { "Content-Type": "application/json", ETag: '"v1"' },
        body: '{"id":"x"}',
      },
      httpGateway,
    );

    expect(body).toBe('{"id":"x"}');
    expect(httpGateway.statusCode).toBe(201);
    expect(httpGateway.responseHeaders).toEqual({
      "Content-Type": ["application/json"],
      ETag: ['"v1"'],
    });
  });
});

describe("createFdkHandler", () => {
  function setup() {
    const logs: string[] = [];
    const handle = createHandler({
      repository: new InMemoryMemoRepository(),
      clock: new ManualClock(NOW),
      idGenerator: new SequentialIdGenerator(),
      log: (line) => logs.push(line),
      timer: () => 0,
    });
    return { logs, fdkHandler: createFdkHandler(handle) };
  }

  it("FDK の入力をアダプター層に渡し、結果を FDK の応答に書く", async () => {
    const { logs, fdkHandler } = setup();
    const ctx = fakeContext({
      callID: "call-42",
      method: "POST",
      requestURL: "/api/memos",
      headers: { "Content-Type": ["application/json"] },
    });

    const result = await fdkHandler(JSON.stringify({ title: "買い物" }), ctx);

    expect(ctx.httpGateway.statusCode).toBe(201);
    expect(ctx.httpGateway.responseHeaders["Content-Type"]).toEqual(["application/json"]);
    expect(ctx.httpGateway.responseHeaders["Location"]?.[0]).toMatch(/^\/api\/memos\/[0-9A-Z]{26}$/);
    expect(ctx.httpGateway.responseHeaders["ETag"]).toHaveLength(1);
    expect(JSON.parse(writtenBody(result))).toMatchObject({ title: "買い物", body: "" });
    expect(JSON.parse(logs[0] ?? "")).toMatchObject({ requestId: "call-42", status: 201 });
  });

  it("Content-Type が呼び出しそのもののヘッダーとして届いた POST も作成できる(415 にしない)", async () => {
    const { fdkHandler } = setup();
    const ctx = fakeContext({
      method: "POST",
      requestURL: "/api/memos",
      invocationHeaders: { "Content-Type": ["application/json"], "Fn-Call-Id": ["call-1"] },
    });

    await fdkHandler(JSON.stringify({ title: "買い物" }), ctx);

    expect(ctx.httpGateway.statusCode).toBe(201);
  });

  it("204 はボディを空文字で返す", async () => {
    const { fdkHandler } = setup();
    const created = fakeContext({
      method: "POST",
      headers: { "Content-Type": ["application/json"] },
    });
    await fdkHandler(JSON.stringify({ title: "t" }), created);
    const location = created.httpGateway.responseHeaders["Location"]?.[0] ?? "";

    const ctx = fakeContext({ method: "DELETE", requestURL: location });
    const result = await fdkHandler("", ctx);

    expect(ctx.httpGateway.statusCode).toBe(204);
    expect(writtenBody(result)).toBe("");
  });

  it("アダプター層の JSON のボディを、FDK にもう一度 JSON にさせずにそのまま書き出す", async () => {
    const { fdkHandler } = setup();
    const ctx = fakeContext({
      method: "POST",
      headers: { "Content-Type": ["application/json"] },
    });

    const result = await fdkHandler(JSON.stringify({ title: "買い物" }), ctx);

    const written = writtenBody(result);
    expect(written.startsWith("{")).toBe(true);
    expect(typeof JSON.parse(written)).toBe("object");
  });

  it("problem+json のボディも、そのまま書き出す", async () => {
    const { fdkHandler } = setup();
    const ctx = fakeContext({ method: "GET", requestURL: "/api/memos/01ARZ3NDEKTSV4RRFFQ69G5FAV" });

    const result = await fdkHandler("", ctx);

    expect(ctx.httpGateway.statusCode).toBe(404);
    expect(JSON.parse(writtenBody(result))).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
