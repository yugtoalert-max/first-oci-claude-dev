import { describe, expect, it, vi } from "vitest";
import { JSON_HEADERS, json, setup } from "./test-support";

describe("problem+json(SPEC 6 章)", () => {
  it("RFC 9457 の形に code を足し、VALIDATION_FAILED では errors を付ける", async () => {
    const { request } = setup();

    const response = await request("POST", "/api/memos", {
      headers: JSON_HEADERS,
      body: { title: "a".repeat(201) },
    });

    expect(response.status).toBe(400);
    expect(response.headers["Content-Type"]).toBe("application/problem+json");
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(json(response)).toEqual({
      type: "about:blank",
      title: "Validation failed",
      status: 400,
      code: "VALIDATION_FAILED",
      detail: expect.any(String),
      errors: [{ field: "title", reason: "TOO_LONG" }],
    });
  });

  it("VALIDATION_FAILED 以外には errors を付けない", async () => {
    const { request } = setup();

    const response = await request("POST", "/api/memos", { headers: JSON_HEADERS, body: "{" });

    expect(response.status).toBe(400);
    const problem = json(response) as Record<string, unknown>;
    expect(problem).toMatchObject({ type: "about:blank", status: 400, code: "INVALID_JSON" });
    expect(problem).not.toHaveProperty("errors");
  });

  it("未定義のキーは UNKNOWN_FIELD", async () => {
    const { request } = setup();

    const response = await request("POST", "/api/memos", {
      headers: JSON_HEADERS,
      body: { title: "x", tittle: "y" },
    });

    expect(json(response)).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ field: "tittle", reason: "UNKNOWN_FIELD" }],
    });
  });

  it("ボディがオブジェクトでなければ INVALID_TYPE(field は空文字)", async () => {
    const { request } = setup();

    const response = await request("POST", "/api/memos", { headers: JSON_HEADERS, body: "[]" });

    expect(json(response)).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ field: "", reason: "INVALID_TYPE" }],
    });
  });

  it("PATCH の {} は NO_CHANGES(field は空文字)", async () => {
    const { request, create } = setup();
    const { id, etag } = await create();

    const response = await request("PATCH", `/api/memos/${id}`, {
      headers: { ...JSON_HEADERS, "If-Match": etag },
      body: {},
    });

    expect(json(response)).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ field: "", reason: "NO_CHANGES" }],
    });
  });

  it("PATCH の null は INVALID_TYPE", async () => {
    const { request, create } = setup();
    const { id, etag } = await create();

    const response = await request("PATCH", `/api/memos/${id}`, {
      headers: { ...JSON_HEADERS, "If-Match": etag },
      body: { title: null, body: null },
    });

    expect(json(response)).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [
        { field: "title", reason: "INVALID_TYPE" },
        { field: "body", reason: "INVALID_TYPE" },
      ],
    });
  });

  it.each([
    ["0", "OUT_OF_RANGE"],
    ["51", "OUT_OF_RANGE"],
    ["1.5", "INVALID_FORMAT"],
    ["abc", "INVALID_FORMAT"],
    ["", "INVALID_FORMAT"],
  ])("limit=%s は 400(%s)", async (limit, reason) => {
    const { request } = setup();

    const response = await request("GET", `/api/memos?limit=${limit}`);

    expect(response.status).toBe(400);
    expect(json(response)).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ field: "limit", reason }],
    });
  });

  it("復号できない cursor は 400(field は cursor)", async () => {
    const { request } = setup();

    const response = await request("GET", "/api/memos?cursor=not-a-cursor");

    expect(response.status).toBe(400);
    expect(json(response)).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ field: "cursor", reason: "INVALID_FORMAT" }],
    });
  });

  it("スロットリングは 429 で、Retry-After: 1 を付ける", async () => {
    const { request, repository } = setup();
    repository.throttled = true;

    const response = await request("GET", "/api/memos");

    expect(response.status).toBe(429);
    expect(response.headers["Retry-After"]).toBe("1");
    expect(response.headers["Content-Type"]).toBe("application/problem+json");
    expect(json(response)).toMatchObject({ status: 429, code: "THROTTLED" });
  });

  it("想定外の例外は 500 で、内部の詳細をレスポンスに含めない", async () => {
    const { request, repository } = setup();
    vi.spyOn(repository, "list").mockRejectedValue(new Error("connection reset by peer"));

    const response = await request("GET", "/api/memos");

    expect(response.status).toBe(500);
    expect(response.headers["Content-Type"]).toBe("application/problem+json");
    expect(json(response)).toEqual({
      type: "about:blank",
      title: "Internal server error",
      status: 500,
      code: "INTERNAL",
      detail: expect.any(String),
    });
    expect(response.body).not.toContain("connection reset");
  });
});
