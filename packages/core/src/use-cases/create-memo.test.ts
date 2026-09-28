import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMemoId } from "../id";
import { InMemoryMemoRepository, ManualClock, SequentialIdGenerator } from "../testing";
import { createMemo } from "./create-memo";

const NOW = new Date("2026-09-28T01:23:45.678Z");

describe("createMemo", () => {
  let repository: InMemoryMemoRepository;
  let clock: ManualClock;
  let idGenerator: SequentialIdGenerator;

  beforeEach(() => {
    repository = new InMemoryMemoRepository();
    clock = new ManualClock(NOW);
    idGenerator = new SequentialIdGenerator();
  });

  it("id と時刻をサーバー側で決めて保存し、メモとバージョンを返す", async () => {
    const result = await createMemo({ repository, clock, idGenerator }, { title: "買い物", body: "牛乳" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { memo, version } = result.value;
    expect(isMemoId(memo.id)).toBe(true);
    expect(memo).toEqual({ id: memo.id, title: "買い物", body: "牛乳", createdAt: NOW, updatedAt: NOW });
    expect(await repository.findById(memo.id)).toEqual({ ok: true, value: { memo, version } });
  });

  it("ULID の時刻部分と createdAt は、同じ Clock の同じ時刻から作る", async () => {
    const generate = vi.spyOn(idGenerator, "generate");

    await createMemo({ repository, clock, idGenerator }, { title: "買い物" });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(NOW);
  });

  it("body を省略したら空文字で保存する", async () => {
    const result = await createMemo({ repository, clock, idGenerator }, { title: "買い物" });

    expect(result.ok && result.value.memo.body).toBe("");
  });

  it("検証に失敗したら VALIDATION_FAILED を返し、保存しない", async () => {
    const result = await createMemo({ repository, clock, idGenerator }, { title: "", id: "x" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        errors: expect.arrayContaining([
          { field: "title", reason: "BLANK" },
          { field: "id", reason: "UNKNOWN_FIELD" },
        ]),
      },
    });
    expect(await repository.list({ limit: 10 })).toEqual({ ok: true, value: [] });
  });

  it("スロットリングは THROTTLED を返す", async () => {
    repository.throttled = true;

    const result = await createMemo({ repository, clock, idGenerator }, { title: "買い物" });

    expect(result).toEqual({ ok: false, error: { code: "THROTTLED" } });
  });
});
