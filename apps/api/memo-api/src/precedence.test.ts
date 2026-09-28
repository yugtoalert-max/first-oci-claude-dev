import { describe, expect, it } from "vitest";
import { JSON_HEADERS, MISSING_ID, json, setup } from "./test-support";

// SPEC 4.4: 複数のエラー条件に当てはまるときは、上から順に判定して最初に当たったものを返す
//   2. パスの id の形式 → 404
//   3. If-Match の欠落(PATCH)→ 428。If-Match の形式 → 400
//   4. Content-Type → 415
//   5. JSON の解析 → 400(INVALID_JSON)
//   6. 値の検証 → 400(VALIDATION_FAILED)
//   7. 存在確認 → 404
//   8. バージョンの照合 → 412
//   9. スロットリング → 429
//  10. その他 → 500

const BAD_ID = "not-a-ulid";
const TEXT_HEADERS = { "Content-Type": "text/plain" };

function codeOf(body: string): unknown {
  return (JSON.parse(body) as { code: unknown }).code;
}

describe("判定の順序(SPEC 4.4)", () => {
  describe("2. id の形式が最優先", () => {
    it("PATCH: If-Match なし・Content-Type 違い・壊れた JSON でも 404", async () => {
      const { request } = setup();

      const response = await request("PATCH", `/api/memos/${BAD_ID}`, {
        headers: TEXT_HEADERS,
        body: "{",
      });

      expect(response.status).toBe(404);
      expect(codeOf(response.body)).toBe("NOT_FOUND");
    });

    it("DELETE: If-Match の形式が不正でも 404", async () => {
      const { request } = setup();

      const response = await request("DELETE", `/api/memos/${BAD_ID}`, {
        headers: { "If-Match": "*" },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("3. If-Match", () => {
    it("PATCH で If-Match がなければ、Content-Type 違いより先に 428", async () => {
      const { request } = setup();

      const response = await request("PATCH", `/api/memos/${MISSING_ID}`, {
        headers: TEXT_HEADERS,
        body: "{",
      });

      expect(response.status).toBe(428);
      expect(json(response)).toMatchObject({ status: 428, code: "PRECONDITION_REQUIRED" });
    });

    it.each([
      ["*", "ワイルドカード"],
      ['"a", "b"', "複数の値"],
      ['W/"a"', "弱い ETag"],
      ["abc", "ダブルクォートなし"],
      ['""', "空の ETag"],
    ])("PATCH の If-Match: %s(%s)は、Content-Type 違いより先に 400", async (ifMatch) => {
      const { request } = setup();

      const response = await request("PATCH", `/api/memos/${MISSING_ID}`, {
        headers: { ...TEXT_HEADERS, "If-Match": ifMatch },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(json(response)).toMatchObject({
        code: "VALIDATION_FAILED",
        errors: [{ field: "If-Match", reason: "INVALID_FORMAT" }],
      });
    });

    it("If-Match ヘッダーが複数行で届いたら 400", async () => {
      const { request, create } = setup();
      const { id, etag } = await create();

      const response = await request("PATCH", `/api/memos/${id}`, {
        headers: { ...JSON_HEADERS, "If-Match": [etag, etag] },
        body: { title: "x" },
      });

      expect(response.status).toBe(400);
    });

    it("DELETE の If-Match の形式は、存在確認より先に 400", async () => {
      const { request } = setup();

      const response = await request("DELETE", `/api/memos/${MISSING_ID}`, {
        headers: { "If-Match": "*" },
      });

      expect(response.status).toBe(400);
      expect(json(response)).toMatchObject({
        errors: [{ field: "If-Match", reason: "INVALID_FORMAT" }],
      });
    });
  });

  describe("4. Content-Type", () => {
    it.each([
      ["text/plain", TEXT_HEADERS],
      ["なし", {}],
      ["application/merge-patch+json", { "Content-Type": "application/merge-patch+json" }],
    ])("POST で Content-Type が %s なら、壊れた JSON より先に 415", async (_label, headers) => {
      const { request } = setup();

      const response = await request("POST", "/api/memos", { headers, body: "{" });

      expect(response.status).toBe(415);
      expect(json(response)).toMatchObject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    });

    it("PATCH で Content-Type が JSON でなければ、存在確認より先に 415", async () => {
      const { request } = setup();

      const response = await request("PATCH", `/api/memos/${MISSING_ID}`, {
        headers: { ...TEXT_HEADERS, "If-Match": '"v"' },
        body: JSON.stringify({ title: "x" }),
      });

      expect(response.status).toBe(415);
    });

    it("ボディを受け取らない DELETE では Content-Type を見ない", async () => {
      const { request, create } = setup();
      const { id } = await create();

      const response = await request("DELETE", `/api/memos/${id}`, { headers: TEXT_HEADERS });

      expect(response.status).toBe(204);
    });
  });

  describe("5. JSON の解析", () => {
    it.each([
      ["壊れた JSON", "{"],
      ["空のボディ", ""],
    ])("POST: %s は、値の検証より先に 400(INVALID_JSON)", async (_label, body) => {
      const { request } = setup();

      const response = await request("POST", "/api/memos", { headers: JSON_HEADERS, body });

      expect(response.status).toBe(400);
      expect(codeOf(response.body)).toBe("INVALID_JSON");
    });

    it("PATCH: 壊れた JSON は、存在確認より先に 400(INVALID_JSON)", async () => {
      const { request } = setup();

      const response = await request("PATCH", `/api/memos/${MISSING_ID}`, {
        headers: { ...JSON_HEADERS, "If-Match": '"v"' },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(codeOf(response.body)).toBe("INVALID_JSON");
    });
  });

  describe("6. 値の検証", () => {
    it("PATCH: 値の検証は存在確認より先に 400", async () => {
      const { request } = setup();

      const response = await request("PATCH", `/api/memos/${MISSING_ID}`, {
        headers: { ...JSON_HEADERS, "If-Match": '"v"' },
        body: { title: "" },
      });

      expect(response.status).toBe(400);
      expect(json(response)).toMatchObject({
        code: "VALIDATION_FAILED",
        errors: [{ field: "title", reason: "BLANK" }],
      });
    });

    it("PATCH: 値の検証はバージョンの照合より先に 400", async () => {
      const { request, create } = setup();
      const { id } = await create();

      const response = await request("PATCH", `/api/memos/${id}`, {
        headers: { ...JSON_HEADERS, "If-Match": '"stale"' },
        body: { unknown: 1 },
      });

      expect(response.status).toBe(400);
    });

    it("POST: 値の検証はスロットリングより先に 400", async () => {
      const { request, repository } = setup();
      repository.throttled = true;

      const response = await request("POST", "/api/memos", { headers: JSON_HEADERS, body: {} });

      expect(response.status).toBe(400);
    });

    it("GET 一覧: クエリの検証はスロットリングより先に 400", async () => {
      const { request, repository } = setup();
      repository.throttled = true;

      const response = await request("GET", "/api/memos?limit=0");

      expect(response.status).toBe(400);
    });
  });

  describe("7. 存在確認 → 8. バージョンの照合", () => {
    it("PATCH: 存在しない id は、If-Match が何であっても 412 ではなく 404", async () => {
      const { request } = setup();

      const response = await request("PATCH", `/api/memos/${MISSING_ID}`, {
        headers: { ...JSON_HEADERS, "If-Match": '"stale"' },
        body: { title: "x" },
      });

      expect(response.status).toBe(404);
    });

    it("DELETE: 存在しない id は、If-Match が何であっても 412 ではなく 404", async () => {
      const { request } = setup();

      const response = await request("DELETE", `/api/memos/${MISSING_ID}`, {
        headers: { "If-Match": '"stale"' },
      });

      expect(response.status).toBe(404);
    });
  });
});
