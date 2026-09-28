import { beforeEach, describe, expect, it } from "vitest";
import type { Memo } from "../memo";
import { InMemoryMemoRepository } from "../testing";
import { getMemo } from "./get-memo";

const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";
const AT = new Date("2026-09-28T01:23:45.678Z");
const MEMO: Memo = { id: ID, title: "買い物", body: "牛乳", createdAt: AT, updatedAt: AT };

describe("getMemo", () => {
  let repository: InMemoryMemoRepository;
  let version: string;

  beforeEach(async () => {
    repository = new InMemoryMemoRepository();
    const inserted = await repository.insert(MEMO);
    if (!inserted.ok) throw new Error("insert failed");
    version = inserted.value;
  });

  it("メモとバージョンを返す", async () => {
    expect(await getMemo({ repository }, ID)).toEqual({ ok: true, value: { memo: MEMO, version } });
  });

  it("存在しない id は NOT_FOUND", async () => {
    expect(await getMemo({ repository }, "01J8Z3K5Q7W9X2Y4Z6A8B0C2D9")).toEqual({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it.each([ID.toLowerCase(), "not-a-ulid", ""])(
    "ULID の形式でない id(%j)も NOT_FOUND(存在しない場合と区別しない)",
    async (id) => {
      expect(await getMemo({ repository }, id)).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
    },
  );

  it("スロットリングは THROTTLED を返す", async () => {
    repository.throttled = true;

    expect(await getMemo({ repository }, ID)).toEqual({ ok: false, error: { code: "THROTTLED" } });
  });
});
