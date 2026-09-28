// API クライアントと memo-api のアダプター(createHandler + インメモリのリポジトリ)を組み合わせたテスト。
// 偽の fetch が Request をアダプターの入力に変換し、アダプターの出力を Response に戻す
import { InMemoryMemoRepository, ManualClock, SequentialIdGenerator } from "@memo/core/testing";
import { createHandler } from "@memo/memo-api/handler";
import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "./client";

const ORIGIN = "https://api.example.test";
const NOW = new Date("2026-09-28T01:23:45.678Z");

type HandlerRequest = Parameters<ReturnType<typeof createHandler>>[0];

function setup() {
  const clock = new ManualClock(NOW);
  const handle = createHandler({
    repository: new InMemoryMemoRepository(),
    clock,
    idGenerator: new SequentialIdGenerator(),
    log: () => {},
    timer: () => 0,
  });

  let requestCount = 0;
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url, ORIGIN);
    const headers: HandlerRequest["headers"] = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const response = await handle({
      requestId: `req-${++requestCount}`,
      method: init.method ?? "GET",
      url: parsed.pathname + parsed.search,
      headers,
      body: typeof init.body === "string" ? init.body : "",
    });
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };

  const client = createApiClient({ baseUrl: "/api", getToken: () => "token", fetch });
  return { client, clock };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("API クライアント × memo-api アダプター", () => {
  it("作成 → 取得 → 更新 → 削除 が ETag を受け渡して通る", async () => {
    const { client, clock } = setup();

    const created = unwrap(await client.createMemo({ title: "買い物", body: "牛乳" }));
    expect(created.memo).toEqual({
      id: created.memo.id,
      title: "買い物",
      body: "牛乳",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const fetched = unwrap(await client.getMemo(created.memo.id));
    expect(fetched).toEqual(created);

    clock.advance(1000);
    const updated = unwrap(await client.updateMemo(fetched.memo.id, fetched.etag, { body: "卵" }));
    expect(updated.memo).toEqual({ ...created.memo, body: "卵", updatedAt: new Date(NOW.getTime() + 1000) });
    expect(updated.etag).not.toBe(fetched.etag);

    unwrap(await client.deleteMemo(updated.memo.id, updated.etag));
    expect(await client.getMemo(updated.memo.id)).toEqual({
      ok: false,
      error: { status: 404, code: "NOT_FOUND" },
    });
  });

  it("古い ETag での更新と削除は 412(PRECONDITION_FAILED)になり、最新の ETag なら通る", async () => {
    const { client } = setup();
    const created = unwrap(await client.createMemo({ title: "買い物" }));
    // 別の画面で先に更新された
    const other = unwrap(await client.updateMemo(created.memo.id, created.etag, { title: "夕飯" }));

    expect(await client.updateMemo(created.memo.id, created.etag, { title: "朝食" })).toEqual({
      ok: false,
      error: { status: 412, code: "PRECONDITION_FAILED" },
    });
    expect(await client.deleteMemo(created.memo.id, created.etag)).toEqual({
      ok: false,
      error: { status: 412, code: "PRECONDITION_FAILED" },
    });

    const latest = unwrap(await client.getMemo(created.memo.id));
    expect(latest.etag).toBe(other.etag);
    const retried = unwrap(await client.updateMemo(latest.memo.id, latest.etag, { title: "朝食" }));
    expect(retried.memo.title).toBe("朝食");
  });

  it("nextCursor を受け渡して全ページを新しい順にたどれる", async () => {
    const { client, clock } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(unwrap(await client.createMemo({ title: `${i + 1} 件目` })).memo.id);
      clock.advance(1);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = unwrap(await client.listMemos({ limit: 2, ...(cursor ? { cursor } : {}) }));
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor !== undefined);

    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
  });

  it("検証エラーは VALIDATION_FAILED と errors になる", async () => {
    const { client } = setup();

    expect(await client.createMemo({ title: " " })).toEqual({
      ok: false,
      error: { status: 400, code: "VALIDATION_FAILED", errors: [{ field: "title", reason: "BLANK" }] },
    });
  });
});
