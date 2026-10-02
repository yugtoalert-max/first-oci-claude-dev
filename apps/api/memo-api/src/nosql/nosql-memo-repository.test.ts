import type { Memo } from "@memo/core";
import { Consistency, ErrorCode, NoSQLError, NoSQLTimeoutError, type PreparedStatement } from "oracle-nosqldb";
import { describe, expect, it, vi } from "vitest";
import { NOSQL_TIMEOUT_MS } from "./nosql-config";
import { NoSqlMemoRepository, type NoSqlClientPort } from "./nosql-memo-repository";

// NoSQL クライアントを偽物にして、SDK との受け渡しとエラーの変換を確かめる。
// KVLite に対する振る舞いは nosql-memo-repository.contract.test.ts(npm run test:contract)で確かめる

const TABLE = "memos";
const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";
const AT = new Date("2026-09-28T01:23:45.678Z");
const MEMO: Memo = { id: ID, title: "買い物", body: "牛乳", createdAt: AT, updatedAt: AT };
const ROW = { id: ID, title: "買い物", body: "牛乳", created_at: AT, updated_at: AT };

// base64url にすると "-" と "_" を含む値
const VERSION_BYTES = Buffer.from([0xfb, 0xff, 0x00, 0x01]);
const VERSION = "-_8AAQ";

// SDK のエラーのコンストラクタは型の上では protected。実物のエラーで確かめるために型を外して作る
const SdkError = NoSQLError as unknown as new (code: ErrorCode, message: string) => NoSQLError;
const SdkTimeoutError = NoSQLTimeoutError as unknown as new (
  timeout: number,
  numRetries: number,
  operation: undefined,
  cause: Error,
) => NoSQLTimeoutError;

function sdkError(code: ErrorCode): NoSQLError {
  return new SdkError(code, "test");
}

function timedOut(cause: Error): NoSQLTimeoutError {
  return new SdkTimeoutError(NOSQL_TIMEOUT_MS, 3, undefined, cause);
}

/** prepare が返す文と、copyStatement でできた文に set した値を記録する偽物 */
function fakePreparedStatement(sql: string) {
  const bindings: Record<string, unknown>[] = [];
  const statement = {
    sql,
    copyStatement() {
      const bound: Record<string, unknown> = {};
      bindings.push(bound);
      const copy = {
        sql,
        set(name: string, value: unknown) {
          bound[name] = value;
          return copy;
        },
      };
      return copy;
    },
  };
  return { statement: statement as unknown as PreparedStatement, bindings };
}

function fakeClient(rows: unknown[] = []) {
  const prepared: ReturnType<typeof fakePreparedStatement>[] = [];
  const client = {
    get: vi.fn(async () => ({ row: ROW, version: VERSION_BYTES })),
    putIfAbsent: vi.fn(async () => ({ success: true, version: VERSION_BYTES })),
    putIfVersion: vi.fn(async () => ({ success: true, version: VERSION_BYTES })),
    delete: vi.fn(async () => ({ success: true })),
    deleteIfVersion: vi.fn(async () => ({ success: true })),
    prepare: vi.fn(async (sql: string) => {
      const p = fakePreparedStatement(sql);
      prepared.push(p);
      return p.statement;
    }),
    queryIterable: vi.fn(async function* () {
      yield { rows };
    }),
  };
  const repository = new NoSqlMemoRepository({
    client: client as unknown as NoSqlClientPort,
    tableName: TABLE,
  });
  return { client, repository, prepared };
}

describe("NoSqlMemoRepository", () => {
  describe("行バージョン", () => {
    it("SDK の Buffer を base64url の文字列にして返す(insert)", async () => {
      const { repository } = fakeClient();

      expect(await repository.insert(MEMO)).toEqual({ ok: true, value: VERSION });
    });

    it("SDK の Buffer を base64url の文字列にして返す(findById)", async () => {
      const { repository } = fakeClient();

      expect(await repository.findById(ID)).toEqual({
        ok: true,
        value: { memo: MEMO, version: VERSION },
      });
    });

    it("findById は ABSOLUTE で読む(EVENTUAL で読んだバージョンが照合に通らないことがあった。SPEC 13 章の 17)", async () => {
      const { client, repository } = fakeClient();

      await repository.findById(ID);

      expect(client.get).toHaveBeenCalledWith(TABLE, { id: ID }, {
        timeout: NOSQL_TIMEOUT_MS,
        consistency: Consistency.ABSOLUTE,
      });
    });

    it("base64url の文字列を Buffer に戻して putIfVersion に渡す", async () => {
      const { client, repository } = fakeClient();

      await repository.updateIfVersion(MEMO, VERSION);

      expect(client.putIfVersion).toHaveBeenCalledWith(TABLE, ROW, VERSION_BYTES, {
        timeout: NOSQL_TIMEOUT_MS,
      });
    });

    it("base64url の文字列を Buffer に戻して deleteIfVersion に渡す", async () => {
      const { client, repository } = fakeClient();

      await repository.delete(ID, VERSION);

      expect(client.deleteIfVersion).toHaveBeenCalledWith(TABLE, { id: ID }, VERSION_BYTES, {
        timeout: NOSQL_TIMEOUT_MS,
        returnExisting: true,
      });
    });

    it.each([["a=b"], ["+/AA"], ["a b"], ["-_8AAR"]])(
      "base64url として読めない %j で更新すると、SDK を呼ばずに conflict",
      async (version) => {
        const { client, repository } = fakeClient();

        expect(await repository.updateIfVersion(MEMO, version)).toEqual({
          ok: true,
          value: { kind: "conflict" },
        });
        expect(client.putIfVersion).not.toHaveBeenCalled();
      },
    );

    it("base64url として読めないバージョンで削除すると、行があれば conflict", async () => {
      const { client, repository } = fakeClient();

      expect(await repository.delete(ID, "a=b")).toEqual({ ok: true, value: { kind: "conflict" } });
      expect(client.deleteIfVersion).not.toHaveBeenCalled();
    });

    it("base64url として読めないバージョンで削除すると、行がなければ not_found", async () => {
      const { client, repository } = fakeClient();
      client.get.mockResolvedValueOnce({ row: null } as never);

      expect(await repository.delete(ID, "a=b")).toEqual({
        ok: true,
        value: { kind: "not_found" },
      });
      expect(client.deleteIfVersion).not.toHaveBeenCalled();
    });
  });

  describe("SDK の結果の変換", () => {
    it("putIfAbsent が失敗したら(id の重複)例外を投げる", async () => {
      const { client, repository } = fakeClient();
      client.putIfAbsent.mockResolvedValueOnce({ success: false } as never);

      await expect(repository.insert(MEMO)).rejects.toThrow(/duplicate id/);
    });

    it("deleteIfVersion が失敗して既存の行のバージョンが返れば conflict", async () => {
      const { client, repository } = fakeClient();
      client.deleteIfVersion.mockResolvedValueOnce({
        success: false,
        existingVersion: VERSION_BYTES,
      } as never);

      expect(await repository.delete(ID, VERSION)).toEqual({
        ok: true,
        value: { kind: "conflict" },
      });
    });

    it("deleteIfVersion が失敗して既存の行が返らなければ not_found", async () => {
      const { client, repository } = fakeClient();
      client.deleteIfVersion.mockResolvedValueOnce({ success: false });

      expect(await repository.delete(ID, VERSION)).toEqual({
        ok: true,
        value: { kind: "not_found" },
      });
    });
  });

  describe("一覧のクエリ", () => {
    it("after がなければ、列を絞って id の降順に limit + 1 件を取る", async () => {
      const { repository, prepared } = fakeClient();

      await repository.list({ limit: 20 });

      expect(prepared).toHaveLength(1);
      expect(prepared[0]?.statement.sql).toBe(
        "DECLARE $lim INTEGER; " +
          "SELECT id, title, created_at, updated_at FROM memos ORDER BY id DESC LIMIT $lim",
      );
      expect(prepared[0]?.bindings).toEqual([{ $lim: 21 }]);
    });

    it("after があれば、WHERE id < $after を付ける", async () => {
      const { repository, prepared } = fakeClient();

      await repository.list({ after: ID, limit: 2 });

      expect(prepared[0]?.statement.sql).toBe(
        "DECLARE $after STRING; $lim INTEGER; " +
          "SELECT id, title, created_at, updated_at FROM memos " +
          "WHERE id < $after ORDER BY id DESC LIMIT $lim",
      );
      expect(prepared[0]?.bindings).toEqual([{ $after: ID, $lim: 3 }]);
    });

    it("準備した文は使い回し、呼び出しごとに複製してから値を入れる", async () => {
      const { client, repository, prepared } = fakeClient();

      await repository.list({ limit: 1 });
      await repository.list({ limit: 2 });

      expect(client.prepare).toHaveBeenCalledTimes(1);
      expect(prepared[0]?.bindings).toEqual([{ $lim: 2 }, { $lim: 3 }]);
    });

    it("準備に失敗したら、次の呼び出しで準備し直す", async () => {
      const { client, repository } = fakeClient();
      client.prepare.mockRejectedValueOnce(new Error("network"));

      await expect(repository.list({ limit: 1 })).rejects.toThrow("network");
      await repository.list({ limit: 1 });

      expect(client.prepare).toHaveBeenCalledTimes(2);
    });

    it("行を要約に変換する", async () => {
      const summary = { id: ID, title: "買い物", created_at: AT, updated_at: AT };
      const { repository } = fakeClient([summary]);

      expect(await repository.list({ limit: 1 })).toStrictEqual({
        ok: true,
        value: [{ id: ID, title: "買い物", createdAt: AT, updatedAt: AT }],
      });
    });
  });

  describe("打ち切り時間(SPEC 9.2)", () => {
    it("すべての操作に、リトライ込みの打ち切り時間 5 秒を渡す", async () => {
      const { client, repository } = fakeClient();

      await repository.insert(MEMO);
      await repository.findById(ID);
      await repository.list({ limit: 1 });
      await repository.updateIfVersion(MEMO, VERSION);
      await repository.delete(ID);
      await repository.delete(ID, VERSION);

      const timeout = { timeout: NOSQL_TIMEOUT_MS };
      expect(NOSQL_TIMEOUT_MS).toBe(5000);
      expect(client.putIfAbsent).toHaveBeenCalledWith(TABLE, ROW, timeout);
      expect(client.get).toHaveBeenCalledWith(TABLE, { id: ID }, { ...timeout, consistency: Consistency.ABSOLUTE });
      expect(client.prepare).toHaveBeenCalledWith(expect.any(String), timeout);
      expect(client.queryIterable).toHaveBeenCalledWith(expect.anything(), timeout);
      expect(client.putIfVersion).toHaveBeenCalledWith(TABLE, ROW, VERSION_BYTES, timeout);
      expect(client.delete).toHaveBeenCalledWith(TABLE, { id: ID }, timeout);
      expect(client.deleteIfVersion).toHaveBeenCalledWith(TABLE, { id: ID }, VERSION_BYTES, {
        ...timeout,
        returnExisting: true,
      });
    });
  });

  describe("スロットリングの変換", () => {
    type Repo = NoSqlMemoRepository;
    type Client = ReturnType<typeof fakeClient>["client"];
    const operations: [string, keyof Client, (r: Repo) => Promise<unknown>][] = [
      ["insert", "putIfAbsent", (r) => r.insert(MEMO)],
      ["findById", "get", (r) => r.findById(ID)],
      ["list(準備)", "prepare", (r) => r.list({ limit: 1 })],
      ["list(実行)", "queryIterable", (r) => r.list({ limit: 1 })],
      ["updateIfVersion", "putIfVersion", (r) => r.updateIfVersion(MEMO, VERSION)],
      ["delete", "delete", (r) => r.delete(ID)],
      ["delete(バージョン指定)", "deleteIfVersion", (r) => r.delete(ID, VERSION)],
    ];

    function failWith(client: Client, method: keyof Client, error: Error): void {
      if (method === "queryIterable") {
        // 最初の next() で失敗する async iterable を作る。yield しないのは意図どおり
        // eslint-disable-next-line require-yield
        client.queryIterable.mockImplementationOnce(async function* () {
          throw error;
        });
      } else {
        client[method].mockRejectedValueOnce(error);
      }
    }

    const throttlingErrors: [string, () => Error][] = [
      ["READ_LIMIT_EXCEEDED", () => sdkError(ErrorCode.READ_LIMIT_EXCEEDED)],
      ["WRITE_LIMIT_EXCEEDED", () => sdkError(ErrorCode.WRITE_LIMIT_EXCEEDED)],
      [
        "リトライが打ち切り時間に達した(原因がスロットリング)",
        () => timedOut(sdkError(ErrorCode.WRITE_LIMIT_EXCEEDED)),
      ],
    ];

    describe.each(operations)("%s", (_name, method, call) => {
      it.each(throttlingErrors)("%s は THROTTLED を返す", async (_label, error) => {
        const { client, repository } = fakeClient();
        failWith(client, method, error());

        expect(await call(repository)).toEqual({ ok: false, error: { code: "THROTTLED" } });
      });

      it.each([
        ["原因がスロットリングでない打ち切り", () => timedOut(sdkError(ErrorCode.NETWORK_ERROR))],
        ["SDK のその他のエラー", () => sdkError(ErrorCode.SERVER_ERROR)],
        ["SDK 以外のエラー", () => new Error("unexpected")],
      ])("%s は例外のまま投げる", async (_label, makeError) => {
        const { client, repository } = fakeClient();
        const error = makeError();
        failWith(client, method, error);

        await expect(call(repository)).rejects.toBe(error);
      });
    });
  });

  describe("テーブル名", () => {
    it.each([["memos; DROP TABLE memos"], ["1memos"], [""], ["memo-s"]])(
      "文に埋め込めない %j は受け付けない",
      (tableName) => {
        expect(
          () => new NoSqlMemoRepository({ client: fakeClient().client as never, tableName }),
        ).toThrow(/table name/);
      },
    );
  });
});
