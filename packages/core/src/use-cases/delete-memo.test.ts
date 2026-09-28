import { beforeEach, describe, expect, it } from "vitest";
import type { Memo } from "../memo";
import { InMemoryMemoRepository } from "../testing";
import { deleteMemo } from "./delete-memo";

const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";
const MISSING_ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D9";
const AT = new Date("2026-09-28T01:23:45.678Z");
const MEMO: Memo = { id: ID, title: "買い物", body: "牛乳", createdAt: AT, updatedAt: AT };

describe("deleteMemo", () => {
  let repository: InMemoryMemoRepository;
  let version: string;

  beforeEach(async () => {
    repository = new InMemoryMemoRepository();
    const inserted = await repository.insert(MEMO);
    if (!inserted.ok) throw new Error("insert failed");
    version = inserted.value;
  });

  async function exists(): Promise<boolean> {
    const found = await repository.findById(ID);
    if (!found.ok) throw new Error("find failed");
    return found.value !== null;
  }

  it("バージョンを指定しなければ削除する", async () => {
    expect(await deleteMemo({ repository }, { id: ID })).toEqual({ ok: true, value: undefined });
    expect(await exists()).toBe(false);
  });

  it("バージョンが一致すれば削除する", async () => {
    expect(await deleteMemo({ repository }, { id: ID, expectedVersion: version })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await exists()).toBe(false);
  });

  it("バージョンが一致しなければ PRECONDITION_FAILED を返し、削除しない", async () => {
    expect(await deleteMemo({ repository }, { id: ID, expectedVersion: "stale" })).toEqual({
      ok: false,
      error: { code: "PRECONDITION_FAILED" },
    });
    expect(await exists()).toBe(true);
  });

  it.each([
    ["バージョンなし", undefined],
    ["バージョンあり", "stale"],
  ])("存在しない id は NOT_FOUND(%s)", async (_label, expectedVersion) => {
    expect(await deleteMemo({ repository }, { id: MISSING_ID, expectedVersion })).toEqual({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("ULID の形式でない id は NOT_FOUND", async () => {
    expect(await deleteMemo({ repository }, { id: ID.toLowerCase() })).toEqual({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await exists()).toBe(true);
  });

  it("スロットリングは THROTTLED を返す", async () => {
    repository.throttled = true;

    expect(await deleteMemo({ repository }, { id: ID })).toEqual({
      ok: false,
      error: { code: "THROTTLED" },
    });
  });
});
