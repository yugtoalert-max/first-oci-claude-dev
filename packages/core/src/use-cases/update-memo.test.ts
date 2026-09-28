import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Memo } from "../memo";
import { InMemoryMemoRepository, ManualClock } from "../testing";
import { updateMemo } from "./update-memo";

const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";
const MISSING_ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D9";
const CREATED_AT = new Date("2026-09-28T01:23:45.678Z");
const UPDATED_AT = new Date("2026-09-28T02:00:00.000Z");
const MEMO: Memo = { id: ID, title: "買い物", body: "牛乳", createdAt: CREATED_AT, updatedAt: CREATED_AT };

describe("updateMemo", () => {
  let repository: InMemoryMemoRepository;
  let clock: ManualClock;
  let version: string;

  beforeEach(async () => {
    repository = new InMemoryMemoRepository();
    clock = new ManualClock(UPDATED_AT);
    const inserted = await repository.insert(MEMO);
    if (!inserted.ok) throw new Error("insert failed");
    version = inserted.value;
  });

  async function stored() {
    const found = await repository.findById(ID);
    if (!found.ok) throw new Error("find failed");
    return found.value;
  }

  it("指定したキーだけを変え、updatedAt を進め、新しいバージョンを返す", async () => {
    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { title: "買い物リスト" }, expectedVersion: version },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.memo).toEqual({ ...MEMO, title: "買い物リスト", updatedAt: UPDATED_AT });
    expect(result.value.version).not.toBe(version);
    expect(await stored()).toEqual(result.value);
  });

  it("body を空文字にできる", async () => {
    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { body: "" }, expectedVersion: version },
    );

    expect(result.ok && result.value.memo).toEqual({ ...MEMO, body: "", updatedAt: UPDATED_AT });
  });

  it("値が変わらなくても updatedAt を更新する", async () => {
    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { title: MEMO.title }, expectedVersion: version },
    );

    expect(result.ok && result.value.memo.updatedAt).toEqual(UPDATED_AT);
  });

  it("ULID の形式でない id は NOT_FOUND(入力が不正でも id の判定が先)", async () => {
    const result = await updateMemo(
      { repository, clock },
      { id: ID.toLowerCase(), input: {}, expectedVersion: version },
    );

    expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("入力が不正なら VALIDATION_FAILED(存在確認より先)", async () => {
    const result = await updateMemo(
      { repository, clock },
      { id: MISSING_ID, input: {}, expectedVersion: version },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", errors: [{ field: "", reason: "NO_CHANGES" }] },
    });
  });

  it("入力が不正なら VALIDATION_FAILED(バージョンの照合より先)", async () => {
    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { title: null }, expectedVersion: "stale" },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", errors: [{ field: "title", reason: "INVALID_TYPE" }] },
    });
  });

  it("存在しない id は NOT_FOUND(バージョンの照合より先)", async () => {
    const result = await updateMemo(
      { repository, clock },
      { id: MISSING_ID, input: { title: "x" }, expectedVersion: "stale" },
    );

    expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("バージョンが一致しなければ PRECONDITION_FAILED を返し、書き込まない", async () => {
    const updateIfVersion = vi.spyOn(repository, "updateIfVersion");

    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { title: "x" }, expectedVersion: "stale" },
    );

    expect(result).toEqual({ ok: false, error: { code: "PRECONDITION_FAILED" } });
    expect(updateIfVersion).not.toHaveBeenCalled();
    expect(await stored()).toEqual({ memo: MEMO, version });
  });

  it("書き込み時に競合したら PRECONDITION_FAILED", async () => {
    vi.spyOn(repository, "updateIfVersion").mockResolvedValue({ ok: true, value: { kind: "conflict" } });

    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { title: "x" }, expectedVersion: version },
    );

    expect(result).toEqual({ ok: false, error: { code: "PRECONDITION_FAILED" } });
  });

  it("読み取りでスロットリングしたら THROTTLED", async () => {
    repository.throttled = true;

    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { title: "x" }, expectedVersion: version },
    );

    expect(result).toEqual({ ok: false, error: { code: "THROTTLED" } });
  });

  it("書き込みでスロットリングしたら THROTTLED", async () => {
    vi.spyOn(repository, "updateIfVersion").mockResolvedValue({ ok: false, error: { code: "THROTTLED" } });

    const result = await updateMemo(
      { repository, clock },
      { id: ID, input: { title: "x" }, expectedVersion: version },
    );

    expect(result).toEqual({ ok: false, error: { code: "THROTTLED" } });
  });
});
