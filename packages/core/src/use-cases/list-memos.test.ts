import { beforeEach, describe, expect, it } from "vitest";
import { decodeCursor } from "../cursor";
import { InMemoryMemoRepository, ManualClock, SequentialIdGenerator } from "../testing";
import { createMemo } from "./create-memo";
import { listMemos } from "./list-memos";

describe("listMemos", () => {
  let repository: InMemoryMemoRepository;

  beforeEach(() => {
    repository = new InMemoryMemoRepository();
  });

  // タイトルが "memo 1", "memo 2", ... のメモを古い順に作り、id を作った順に返す
  async function createMemos(count: number): Promise<string[]> {
    const clock = new ManualClock(new Date("2026-09-28T01:23:45.678Z"));
    const idGenerator = new SequentialIdGenerator();
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const result = await createMemo({ repository, clock, idGenerator }, { title: `memo ${i}` });
      if (!result.ok) throw new Error("create failed");
      ids.push(result.value.memo.id);
      clock.advance(1);
    }
    return ids;
  }

  async function titlesOf(query: { limit?: string; cursor?: string }) {
    const result = await listMemos({ repository }, query);
    if (!result.ok) throw new Error("list failed");
    return { titles: result.value.items.map((m) => m.title), nextCursor: result.value.nextCursor };
  }

  it("新しい順に、本文を含まない要約を返す", async () => {
    const [id1, id2] = await createMemos(2);

    const result = await listMemos({ repository }, {});

    expect(result).toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            id: id2,
            title: "memo 2",
            createdAt: new Date("2026-09-28T01:23:45.679Z"),
            updatedAt: new Date("2026-09-28T01:23:45.679Z"),
          },
          {
            id: id1,
            title: "memo 1",
            createdAt: new Date("2026-09-28T01:23:45.678Z"),
            updatedAt: new Date("2026-09-28T01:23:45.678Z"),
          },
        ],
        nextCursor: null,
      },
    });
  });

  it("limit を省略したら 20 件ずつ返す", async () => {
    await createMemos(21);

    const first = await titlesOf({});

    expect(first.titles).toHaveLength(20);
    expect(first.titles[0]).toBe("memo 21");
    expect(first.nextCursor).not.toBeNull();
  });

  it("nextCursor で次のページを読み、最後のページでは nextCursor が null", async () => {
    await createMemos(5);

    const page1 = await titlesOf({ limit: "2" });
    expect(page1.titles).toEqual(["memo 5", "memo 4"]);
    if (page1.nextCursor === null) throw new Error("expected nextCursor");

    const page2 = await titlesOf({ limit: "2", cursor: page1.nextCursor });
    expect(page2.titles).toEqual(["memo 3", "memo 2"]);
    if (page2.nextCursor === null) throw new Error("expected nextCursor");

    const page3 = await titlesOf({ limit: "2", cursor: page2.nextCursor });
    expect(page3).toEqual({ titles: ["memo 1"], nextCursor: null });
  });

  it("nextCursor には最後に返した id が入る", async () => {
    const ids = await createMemos(3);

    const result = await listMemos({ repository }, { limit: "2" });

    if (!result.ok || result.value.nextCursor === null) throw new Error("expected nextCursor");
    expect(decodeCursor(result.value.nextCursor)).toBe(ids[1]);
  });

  it("残りがちょうど limit 件なら nextCursor は null", async () => {
    await createMemos(2);

    expect(await titlesOf({ limit: "2" })).toEqual({ titles: ["memo 2", "memo 1"], nextCursor: null });
  });

  it("0 件なら空の配列と null", async () => {
    expect(await listMemos({ repository }, {})).toEqual({
      ok: true,
      value: { items: [], nextCursor: null },
    });
  });

  it("limit や cursor が不正なら VALIDATION_FAILED", async () => {
    expect(await listMemos({ repository }, { limit: "51" })).toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", errors: [{ field: "limit", reason: "OUT_OF_RANGE" }] },
    });
    expect(await listMemos({ repository }, { cursor: "!!!" })).toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", errors: [{ field: "cursor", reason: "INVALID_FORMAT" }] },
    });
  });

  it("スロットリングは THROTTLED を返す", async () => {
    repository.throttled = true;

    expect(await listMemos({ repository }, {})).toEqual({ ok: false, error: { code: "THROTTLED" } });
  });
});
