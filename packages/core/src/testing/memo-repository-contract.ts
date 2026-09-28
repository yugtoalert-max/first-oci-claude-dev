import { beforeEach, describe, expect, it } from "vitest";
import type { Memo } from "../memo";
import type { MemoRepository } from "../ports";

// MemoRepository の契約テスト(SPEC 9.3)。
// インメモリ実装と NoSQL 実装の両方に対して、同じテストを実行する。

const IDS = [
  "01J8Z3K5Q7W9X2Y4Z6A8B0C2D1",
  "01J8Z3K5Q7W9X2Y4Z6A8B0C2D2",
  "01J8Z3K5Q7W9X2Y4Z6A8B0C2D3",
  "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4",
  "01J8Z3K5Q7W9X2Y4Z6A8B0C2D5",
] as const;
const MISSING_ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D9";
const CREATED_AT = new Date("2026-09-28T01:23:45.678Z");
const UPDATED_AT = new Date("2026-09-28T02:00:00.000Z");

function memo(id: string, title = `title ${id}`): Memo {
  return { id, title, body: `body ${id}`, createdAt: CREATED_AT, updatedAt: CREATED_AT };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

export function describeMemoRepositoryContract(
  name: string,
  createRepository: () => MemoRepository | Promise<MemoRepository>,
): void {
  describe(`MemoRepository の契約: ${name}`, () => {
    let repository: MemoRepository;

    beforeEach(async () => {
      repository = await createRepository();
    });

    async function insertAll(ids: readonly string[]): Promise<void> {
      for (const id of ids) unwrap(await repository.insert(memo(id)));
    }

    describe("insert / findById", () => {
      it("保存したメモとバージョンを取得できる", async () => {
        const version = unwrap(await repository.insert(memo(IDS[0])));

        expect(typeof version).toBe("string");
        expect(unwrap(await repository.findById(IDS[0]))).toEqual({ memo: memo(IDS[0]), version });
      });

      it("存在しない id は null", async () => {
        expect(unwrap(await repository.findById(MISSING_ID))).toBeNull();
      });
    });

    describe("list", () => {
      it("id の降順で、本文を含まない要約を返す", async () => {
        await insertAll([IDS[1], IDS[0], IDS[2]]);

        expect(unwrap(await repository.list({ limit: 10 }))).toStrictEqual([
          { id: IDS[2], title: `title ${IDS[2]}`, createdAt: CREATED_AT, updatedAt: CREATED_AT },
          { id: IDS[1], title: `title ${IDS[1]}`, createdAt: CREATED_AT, updatedAt: CREATED_AT },
          { id: IDS[0], title: `title ${IDS[0]}`, createdAt: CREATED_AT, updatedAt: CREATED_AT },
        ]);
      });

      it("limit + 1 件まで返す", async () => {
        await insertAll(IDS);

        const ids = unwrap(await repository.list({ limit: 2 })).map((s) => s.id);
        expect(ids).toEqual([IDS[4], IDS[3], IDS[2]]);
      });

      it("ちょうど limit 件しかなければ limit 件を返す", async () => {
        await insertAll(IDS);

        expect(unwrap(await repository.list({ limit: 5 }))).toHaveLength(5);
      });

      it("after より小さい id だけを返す", async () => {
        await insertAll(IDS);

        const ids = unwrap(await repository.list({ after: IDS[3], limit: 1 })).map((s) => s.id);
        expect(ids).toEqual([IDS[2], IDS[1]]);
      });

      it("最後のページでは残りだけを返す", async () => {
        await insertAll(IDS);

        const ids = unwrap(await repository.list({ after: IDS[1], limit: 2 })).map((s) => s.id);
        expect(ids).toEqual([IDS[0]]);
      });

      it("0 件なら空の配列", async () => {
        expect(unwrap(await repository.list({ limit: 2 }))).toEqual([]);

        await insertAll(IDS);
        expect(unwrap(await repository.list({ after: IDS[0], limit: 2 }))).toEqual([]);
      });
    });

    describe("updateIfVersion", () => {
      it("バージョンが一致すれば書き込み、新しいバージョンを返す", async () => {
        const version = unwrap(await repository.insert(memo(IDS[0])));
        const updated: Memo = { ...memo(IDS[0], "新しいタイトル"), updatedAt: UPDATED_AT };

        const outcome = unwrap(await repository.updateIfVersion(updated, version));

        expect(outcome.kind).toBe("updated");
        if (outcome.kind !== "updated") return;
        expect(outcome.version).not.toBe(version);
        expect(unwrap(await repository.findById(IDS[0]))).toEqual({
          memo: updated,
          version: outcome.version,
        });
      });

      it("書き込むたびにバージョンが変わる(値が同じでも)", async () => {
        const v1 = unwrap(await repository.insert(memo(IDS[0])));
        const o2 = unwrap(await repository.updateIfVersion(memo(IDS[0]), v1));
        if (o2.kind !== "updated") throw new Error("expected updated");
        const o3 = unwrap(await repository.updateIfVersion(memo(IDS[0]), o2.version));
        if (o3.kind !== "updated") throw new Error("expected updated");

        expect(new Set([v1, o2.version, o3.version]).size).toBe(3);
      });

      it("バージョンが一致しなければ conflict を返し、書き込まない", async () => {
        const v1 = unwrap(await repository.insert(memo(IDS[0])));
        const o2 = unwrap(await repository.updateIfVersion(memo(IDS[0], "2 回目"), v1));
        if (o2.kind !== "updated") throw new Error("expected updated");

        const outcome = unwrap(await repository.updateIfVersion(memo(IDS[0], "古い版から"), v1));

        expect(outcome).toEqual({ kind: "conflict" });
        expect(unwrap(await repository.findById(IDS[0]))).toEqual({
          memo: memo(IDS[0], "2 回目"),
          version: o2.version,
        });
      });

      it("存在しない id は conflict を返し、作らない", async () => {
        const version = unwrap(await repository.insert(memo(IDS[0])));

        const outcome = unwrap(await repository.updateIfVersion(memo(MISSING_ID), version));

        expect(outcome).toEqual({ kind: "conflict" });
        expect(unwrap(await repository.findById(MISSING_ID))).toBeNull();
      });
    });

    describe("delete", () => {
      it("バージョンを指定しなければ無条件に削除する", async () => {
        await insertAll([IDS[0]]);

        expect(unwrap(await repository.delete(IDS[0]))).toEqual({ kind: "deleted" });
        expect(unwrap(await repository.findById(IDS[0]))).toBeNull();
      });

      it("バージョンが一致すれば削除する", async () => {
        const version = unwrap(await repository.insert(memo(IDS[0])));

        expect(unwrap(await repository.delete(IDS[0], version))).toEqual({ kind: "deleted" });
        expect(unwrap(await repository.findById(IDS[0]))).toBeNull();
      });

      it("バージョンが一致しなければ conflict を返し、削除しない", async () => {
        const v1 = unwrap(await repository.insert(memo(IDS[0])));
        unwrap(await repository.updateIfVersion(memo(IDS[0]), v1));

        expect(unwrap(await repository.delete(IDS[0], v1))).toEqual({ kind: "conflict" });
        expect(unwrap(await repository.findById(IDS[0]))).not.toBeNull();
      });

      it("存在しない id は not_found(バージョンの有無にかかわらず)", async () => {
        const version = unwrap(await repository.insert(memo(IDS[0])));

        expect(unwrap(await repository.delete(MISSING_ID))).toEqual({ kind: "not_found" });
        expect(unwrap(await repository.delete(MISSING_ID, version))).toEqual({
          kind: "not_found",
        });
      });
    });
  });
}
