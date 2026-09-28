import { describe, expect, it } from "vitest";
import { InMemoryMemoRepository } from "./in-memory-memo-repository";
import { describeMemoRepositoryContract } from "./memo-repository-contract";

describeMemoRepositoryContract("InMemoryMemoRepository", () => new InMemoryMemoRepository());

describe("InMemoryMemoRepository のスロットリングの再現", () => {
  it("throttled を true にすると、すべての操作が THROTTLED を返す", async () => {
    const repository = new InMemoryMemoRepository();
    repository.throttled = true;
    const id = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";
    const at = new Date("2026-09-28T01:23:45.678Z");
    const memo = { id, title: "t", body: "b", createdAt: at, updatedAt: at };
    const throttled = { ok: false, error: { code: "THROTTLED" } };

    expect(await repository.insert(memo)).toEqual(throttled);
    expect(await repository.findById(id)).toEqual(throttled);
    expect(await repository.list({ limit: 1 })).toEqual(throttled);
    expect(await repository.updateIfVersion(memo, "v")).toEqual(throttled);
    expect(await repository.delete(id)).toEqual(throttled);
  });
});
