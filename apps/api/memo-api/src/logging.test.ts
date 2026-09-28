import { describe, expect, it, vi } from "vitest";
import { JSON_HEADERS, MISSING_ID, setup } from "./test-support";

// SPEC 9.4: 1 リクエスト 1 行の JSON。title・body・トークン・Authorization ヘッダーは出さない

function parseLines(logs: string[]): Record<string, unknown>[] {
  return logs.map((line) => {
    expect(line).not.toContain("\n");
    return JSON.parse(line) as Record<string, unknown>;
  });
}

describe("ログ(SPEC 9.4)", () => {
  it("1 リクエストにつき 1 行の JSON を出し、ルートはテンプレートで書く", async () => {
    const { request, create, logs } = setup();
    const { id } = await create();
    logs.length = 0;

    await request("GET", `/api/memos/${id}`);

    expect(logs).toHaveLength(1);
    expect(parseLines(logs)[0]).toEqual({
      requestId: "req-1",
      method: "GET",
      route: "/api/memos/{id}",
      status: 200,
      durationMs: 5,
    });
  });

  it("エラーのときは code を出す", async () => {
    const { request, logs } = setup();

    await request("GET", `/api/memos/${MISSING_ID}`);

    expect(parseLines(logs)[0]).toMatchObject({
      route: "/api/memos/{id}",
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("一覧と作成のルートは /api/memos", async () => {
    const { request, logs } = setup();

    await request("GET", "/api/memos?limit=5");
    await request("POST", "/api/memos", { headers: JSON_HEADERS, body: { title: "x" } });

    expect(parseLines(logs).map((entry) => [entry.method, entry.route, entry.status])).toEqual([
      ["GET", "/api/memos", 200],
      ["POST", "/api/memos", 201],
    ]);
  });

  it("定義していないルートは route を null にする", async () => {
    const { request, logs } = setup();

    await request("GET", "/api/secret-path");

    expect(parseLines(logs)[0]).toMatchObject({ route: null, status: 404, code: "NOT_FOUND" });
  });

  it("title・body・トークン・Authorization ヘッダーを出さない", async () => {
    const { request, create, logs } = setup();
    const { id, etag } = await create({ title: "TITLE-SECRET", body: "BODY-SECRET" });
    await request("PATCH", `/api/memos/${id}`, {
      headers: { ...JSON_HEADERS, "If-Match": etag, Authorization: "Bearer TOKEN-SECRET" },
      body: { title: "TITLE-SECRET-2", body: "BODY-SECRET-2" },
    });
    await request("POST", "/api/memos", {
      headers: { ...JSON_HEADERS, Authorization: "Bearer TOKEN-SECRET" },
      body: { title: "a".repeat(201), body: "BODY-SECRET-3" },
    });

    const all = logs.join("\n");
    expect(logs).toHaveLength(3);
    expect(all).not.toMatch(/SECRET/);
    expect(all).not.toMatch(/authorization/i);
  });

  it("500 のときは原因の例外をログに出す", async () => {
    const { request, repository, logs } = setup();
    vi.spyOn(repository, "findById").mockRejectedValue(new Error("connection reset by peer"));

    await request("GET", `/api/memos/${MISSING_ID}`);

    const [entry] = parseLines(logs);
    expect(entry).toMatchObject({
      status: 500,
      code: "INTERNAL",
      error: { name: "Error", message: "connection reset by peer", stack: expect.any(String) },
    });
  });

  it("Error 以外が投げられても 500 にしてログに出す", async () => {
    const { request, repository, logs } = setup();
    vi.spyOn(repository, "findById").mockRejectedValue("plain string");

    const response = await request("GET", `/api/memos/${MISSING_ID}`);

    expect(response.status).toBe(500);
    expect(parseLines(logs)[0]).toMatchObject({ error: { message: "plain string" } });
  });
});
