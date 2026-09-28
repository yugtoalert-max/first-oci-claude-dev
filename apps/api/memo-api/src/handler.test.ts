import { describe, expect, it } from "vitest";
import { JSON_HEADERS, MISSING_ID, NOW, json, setup } from "./test-support";

const ISO_NOW = NOW.toISOString();

describe("POST /api/memos", () => {
  it("201 で、Location と ETag を付けてメモの完全な形を返す", async () => {
    const { request } = setup();

    const response = await request("POST", "/api/memos", {
      headers: JSON_HEADERS,
      body: { title: "買い物", body: "牛乳\n卵" },
    });

    expect(response.status).toBe(201);
    const memo = json(response) as { id: string };
    expect(memo).toEqual({
      id: memo.id,
      title: "買い物",
      body: "牛乳\n卵",
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    });
    expect(response.headers["Location"]).toBe(`/api/memos/${memo.id}`);
    expect(response.headers["ETag"]).toMatch(/^"[^"]+"$/);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  it("body を省略したら空文字として作る", async () => {
    const { request } = setup();

    const response = await request("POST", "/api/memos", {
      headers: JSON_HEADERS,
      body: { title: "買い物" },
    });

    expect(response.status).toBe(201);
    expect(json(response)).toMatchObject({ body: "" });
  });

  it("charset 付きの Content-Type を受け付ける", async () => {
    const { request } = setup();

    const response = await request("POST", "/api/memos", {
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { title: "買い物" },
    });

    expect(response.status).toBe(201);
  });
});

describe("GET /api/memos", () => {
  it("200 で、新しい順の要約(本文なし)と nextCursor を返す", async () => {
    const { request, create, clock } = setup();
    const first = await create({ title: "1 件目", body: "本文" });
    clock.advance(1);
    const second = await create({ title: "2 件目" });

    const response = await request("GET", "/api/memos");

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.headers["ETag"]).toBeUndefined();
    const oneMsLater = new Date(NOW.getTime() + 1).toISOString();
    expect(json(response)).toEqual({
      items: [
        { id: second.id, title: "2 件目", createdAt: oneMsLater, updatedAt: oneMsLater },
        { id: first.id, title: "1 件目", createdAt: ISO_NOW, updatedAt: ISO_NOW },
      ],
      nextCursor: null,
    });
  });

  it("limit と cursor でページを分け、最後のページでは nextCursor が null", async () => {
    const { request, create, clock } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await create({ title: `メモ ${i}` })).id);
      clock.advance(1);
    }

    const page1 = json(await request("GET", "/api/memos?limit=2")) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(page1.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2 = json(
      await request("GET", `/api/memos?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`),
    ) as { items: { id: string }[]; nextCursor: string | null };
    expect(page2.items.map((item) => item.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
  });

  it("メモがなければ空の配列を返す", async () => {
    const { request } = setup();

    expect(json(await request("GET", "/api/memos"))).toEqual({ items: [], nextCursor: null });
  });
});

describe("GET /api/memos/{id}", () => {
  it("200 で、ETag を付けてメモの完全な形を返す", async () => {
    const { request, create } = setup();
    const { id, etag } = await create({ title: "買い物", body: "牛乳" });

    const response = await request("GET", `/api/memos/${id}`);

    expect(response.status).toBe(200);
    expect(response.headers["ETag"]).toBe(etag);
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(json(response)).toEqual({
      id,
      title: "買い物",
      body: "牛乳",
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    });
  });

  it("存在しない id は 404", async () => {
    const { request } = setup();

    const response = await request("GET", `/api/memos/${MISSING_ID}`);

    expect(response.status).toBe(404);
    expect(json(response)).toMatchObject({ code: "NOT_FOUND" });
  });

  it("形式が不正な id(小文字を含む)も 404", async () => {
    const { request, create } = setup();
    const { id } = await create();

    const response = await request("GET", `/api/memos/${id.toLowerCase()}`);

    expect(response.status).toBe(404);
    expect(json(response)).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PATCH /api/memos/{id}", () => {
  it("200 で、新しい ETag を付けて更新後のメモを返す", async () => {
    const { request, create, clock } = setup();
    const { id, etag } = await create({ title: "買い物", body: "牛乳" });
    clock.advance(1000);

    const response = await request("PATCH", `/api/memos/${id}`, {
      headers: { ...JSON_HEADERS, "If-Match": etag },
      body: { body: "" },
    });

    expect(response.status).toBe(200);
    expect(response.headers["ETag"]).toMatch(/^"[^"]+"$/);
    expect(response.headers["ETag"]).not.toBe(etag);
    expect(json(response)).toEqual({
      id,
      title: "買い物",
      body: "",
      createdAt: ISO_NOW,
      updatedAt: new Date(NOW.getTime() + 1000).toISOString(),
    });
  });

  it("ヘッダー名の大文字・小文字を区別しない", async () => {
    const { request, create } = setup();
    const { id, etag } = await create();

    const response = await request("PATCH", `/api/memos/${id}`, {
      headers: { "content-type": "application/json", "if-match": etag },
      body: { title: "新しい題名" },
    });

    expect(response.status).toBe(200);
  });

  it("ETag が一致しなければ 412", async () => {
    const { request, create } = setup();
    const { id, etag } = await create();
    await request("PATCH", `/api/memos/${id}`, {
      headers: { ...JSON_HEADERS, "If-Match": etag },
      body: { title: "先に更新" },
    });

    const response = await request("PATCH", `/api/memos/${id}`, {
      headers: { ...JSON_HEADERS, "If-Match": etag },
      body: { title: "後から更新" },
    });

    expect(response.status).toBe(412);
    expect(json(response)).toMatchObject({ status: 412, code: "PRECONDITION_FAILED" });
  });

  it("存在しない id は 404", async () => {
    const { request } = setup();

    const response = await request("PATCH", `/api/memos/${MISSING_ID}`, {
      headers: { ...JSON_HEADERS, "If-Match": '"any"' },
      body: { title: "x" },
    });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/memos/{id}", () => {
  it("If-Match なしでも削除でき、204 でボディを返さない", async () => {
    const { request, create } = setup();
    const { id } = await create();

    const response = await request("DELETE", `/api/memos/${id}`);

    expect(response.status).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["Content-Type"]).toBeUndefined();
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect((await request("GET", `/api/memos/${id}`)).status).toBe(404);
  });

  it("一致する If-Match を付ければ削除できる", async () => {
    const { request, create } = setup();
    const { id, etag } = await create();

    const response = await request("DELETE", `/api/memos/${id}`, { headers: { "If-Match": etag } });

    expect(response.status).toBe(204);
  });

  it("If-Match が一致しなければ 412 で、削除しない", async () => {
    const { request, create } = setup();
    const { id } = await create();

    const response = await request("DELETE", `/api/memos/${id}`, {
      headers: { "If-Match": '"stale"' },
    });

    expect(response.status).toBe(412);
    expect(json(response)).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await request("GET", `/api/memos/${id}`)).status).toBe(200);
  });

  it("存在しない id は If-Match の有無にかかわらず 404", async () => {
    const { request } = setup();

    expect((await request("DELETE", `/api/memos/${MISSING_ID}`)).status).toBe(404);
    expect(
      (await request("DELETE", `/api/memos/${MISSING_ID}`, { headers: { "If-Match": '"x"' } }))
        .status,
    ).toBe(404);
  });
});

describe("定義していないルート", () => {
  it.each([
    ["GET", "/api/other"],
    ["GET", "/api/memos/"],
    ["GET", "/api/memos/01J8Z3K5Q7W9X2Y4Z6A8B0C2D4/extra"],
    ["PUT", "/api/memos/01J8Z3K5Q7W9X2Y4Z6A8B0C2D4"],
    ["DELETE", "/api/memos"],
  ])("%s %s は 404(NOT_FOUND)", async (method, url) => {
    const { request } = setup();

    const response = await request(method, url);

    expect(response.status).toBe(404);
    expect(response.headers["Content-Type"]).toBe("application/problem+json");
    expect(json(response)).toMatchObject({ code: "NOT_FOUND" });
  });
});
