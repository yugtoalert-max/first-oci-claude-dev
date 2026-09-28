import { describeMemoRepositoryContract } from "@memo/core/testing";
import type { NoSQLClient } from "oracle-nosqldb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearTable, connectKvlite, CONTRACT_TABLE } from "./kvlite-support";
import { NoSqlMemoRepository } from "./nosql-memo-repository";

// KVLite(ローカルの Docker)に対する契約テスト。npm run test:contract で実行する(SPEC 9.3)

let client: NoSQLClient;

beforeAll(async () => {
  client = await connectKvlite();
});

afterAll(async () => {
  await client?.close();
});

async function createRepository(): Promise<NoSqlMemoRepository> {
  await clearTable(client);
  return new NoSqlMemoRepository({ client, tableName: CONTRACT_TABLE });
}

describeMemoRepositoryContract("NoSqlMemoRepository(KVLite)", createRepository);

// 契約テストにない、NoSQL 実装だけの確認
describe("NoSqlMemoRepository(KVLite)", () => {
  const id = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";
  const at = new Date("2026-09-28T01:23:45.678Z");
  const memo = { id, title: "買い物", body: "牛乳\n卵", createdAt: at, updatedAt: at };
  let repository: NoSqlMemoRepository;

  beforeEach(async () => {
    repository = await createRepository();
  });

  it("バージョンは base64url の文字列(ETag にそのまま入れられる)", async () => {
    const result = await repository.insert(memo);

    expect(result.ok && result.value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("base64url として読めないバージョンでは、更新も削除もしない", async () => {
    await repository.insert(memo);

    expect(await repository.updateIfVersion({ ...memo, title: "x" }, "a=b")).toEqual({
      ok: true,
      value: { kind: "conflict" },
    });
    expect(await repository.delete(id, "a=b")).toEqual({ ok: true, value: { kind: "conflict" } });
    expect(await repository.findById(id)).toMatchObject({ ok: true, value: { memo } });
  });

  it("ミリ秒までの時刻と、改行や日本語を含む本文をそのまま保存する", async () => {
    await repository.insert(memo);

    expect(await repository.findById(id)).toMatchObject({ ok: true, value: { memo } });
  });

  it("一覧は 51 件(limit 50 + 1)を id の降順で返す", async () => {
    const ids = Array.from(
      { length: 60 },
      (_, i) => `01J8Z3K5Q7W9X2Y4Z6A8B0C${String(i).padStart(3, "0")}`,
    );
    for (const each of ids) await repository.insert({ ...memo, id: each });

    const result = await repository.list({ limit: 50 });

    expect(result.ok && result.value.map((s) => s.id)).toEqual([...ids].reverse().slice(0, 51));
  });
});
