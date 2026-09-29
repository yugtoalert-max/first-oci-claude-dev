import {
  type DeleteOutcome,
  err,
  type Memo,
  type MemoId,
  type MemoRepository,
  type MemoSummary,
  ok,
  type RepositoryError,
  type Result,
  type UpdateOutcome,
  type Version,
  type VersionedMemo,
} from "@memo/core";
import {
  Consistency,
  ErrorCode,
  type NoSQLClient,
  NoSQLError,
  NoSQLTimeoutError,
  type PreparedStatement,
  type RowVersion,
} from "oracle-nosqldb";
import { NOSQL_TIMEOUT_MS } from "./nosql-config";

/** リポジトリが使う NoSQL クライアントの操作。テストでは偽物に差し替える */
export type NoSqlClientPort = Pick<
  NoSQLClient,
  "get" | "putIfAbsent" | "putIfVersion" | "delete" | "deleteIfVersion" | "prepare" | "queryIterable"
>;

/** テーブルの行(列名は infra/modules/nosql/main.tf のもの) */
type MemoRow = {
  id: string;
  title: string;
  body: string;
  created_at: Date;
  updated_at: Date;
};

type SummaryRow = Omit<MemoRow, "body">;

const THROTTLED = { code: "THROTTLED" } as const;

/** プロビジョンドの読み取り・書き込みユニットを超えたときのエラー */
const THROTTLING_CODES: readonly ErrorCode[] = [
  ErrorCode.READ_LIMIT_EXCEEDED,
  ErrorCode.WRITE_LIMIT_EXCEEDED,
];

/**
 * スロットリングか。SDK はスロットリングを自動でリトライし、
 * 打ち切り時間に達すると最後のエラーを cause に入れた NoSQLTimeoutError を投げる。
 * リトライの回数の上限に先に達したときは、スロットリングのエラーがそのまま届く
 */
function isThrottling(error: unknown): boolean {
  if (!(error instanceof NoSQLError)) return false;
  if (THROTTLING_CODES.includes(error.errorCode)) return true;
  return error instanceof NoSQLTimeoutError && isThrottling(error.cause);
}

// 文に埋め込むので、識別子として安全な名前だけを受け付ける
const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 行バージョン(Buffer)を opaque な文字列にする(SPEC 3.4) */
function encodeVersion(version: RowVersion): Version {
  return version.toString("base64url");
}

/** encodeVersion で作れない文字列なら undefined。そのようなバージョンと一致する行はない */
function decodeVersion(version: Version): RowVersion | undefined {
  if (!BASE64URL_PATTERN.test(version)) return undefined;
  const bytes = Buffer.from(version, "base64url");
  if (bytes.toString("base64url") !== version) return undefined;
  return bytes as RowVersion;
}

function toRow(memo: Memo): MemoRow {
  return {
    id: memo.id,
    title: memo.title,
    body: memo.body,
    created_at: memo.createdAt,
    updated_at: memo.updatedAt,
  };
}

function toMemo(row: MemoRow): Memo {
  return { ...toSummary(row), body: row.body };
}

function toSummary(row: SummaryRow): MemoSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** SDK の結果に行バージョンがないのは想定外なので、例外にする */
function requireVersion(version: RowVersion | undefined): Version {
  if (version === undefined) throw new Error("NoSQL returned no row version");
  return encodeVersion(version);
}

export class NoSqlMemoRepository implements MemoRepository {
  private readonly client: NoSqlClientPort;
  private readonly tableName: string;
  private readonly statements: { first: string; after: string };
  private readonly prepared = new Map<string, Promise<PreparedStatement>>();

  constructor(options: { client: NoSqlClientPort; tableName: string }) {
    if (!TABLE_NAME_PATTERN.test(options.tableName)) {
      throw new Error(`invalid table name: ${JSON.stringify(options.tableName)}`);
    }
    this.client = options.client;
    this.tableName = options.tableName;

    // 一覧では本文を返さないので、列を絞る(SPEC 4.3)
    const select = `SELECT id, title, created_at, updated_at FROM ${this.tableName}`;
    this.statements = {
      first: `DECLARE $lim INTEGER; ${select} ORDER BY id DESC LIMIT $lim`,
      after: `DECLARE $after STRING; $lim INTEGER; ${select} WHERE id < $after ORDER BY id DESC LIMIT $lim`,
    };
  }

  async insert(memo: Memo): Promise<Result<Version, RepositoryError>> {
    return this.run(async () => {
      const result = await this.client.putIfAbsent(this.tableName, toRow(memo), {
        timeout: NOSQL_TIMEOUT_MS,
      });
      if (!result.success) throw new Error(`duplicate id: ${memo.id}`);
      return requireVersion(result.version);
    });
  }

  async findById(id: MemoId): Promise<Result<VersionedMemo | null, RepositoryError>> {
    return this.run(async () => {
      // ABSOLUTE で読む。EVENTUAL で読んだバージョンが putIfVersion / deleteIfVersion の照合に
      // 通らないことが stg であった(SPEC 13 章の 17)。読み取りユニットは EVENTUAL の 2 倍かかる
      const result = await this.client.get<MemoRow>(this.tableName, { id }, {
        timeout: NOSQL_TIMEOUT_MS,
        consistency: Consistency.ABSOLUTE,
      });
      if (result.row === null) return null;
      return { memo: toMemo(result.row), version: requireVersion(result.version) };
    });
  }

  async list(query: {
    after?: MemoId;
    limit: number;
  }): Promise<Result<MemoSummary[], RepositoryError>> {
    return this.run(async () => {
      const { after } = query;
      const statement = (
        await this.prepare(after === undefined ? this.statements.first : this.statements.after)
      ).copyStatement();
      if (after !== undefined) statement.set("$after", after);
      statement.set("$lim", query.limit + 1);

      // 結果が複数回に分かれて返ることがあるので、最後まで読む。打ち切り時間は 1 回ごとにかかる
      const summaries: MemoSummary[] = [];
      for await (const result of this.client.queryIterable<SummaryRow>(statement, {
        timeout: NOSQL_TIMEOUT_MS,
      })) {
        summaries.push(...result.rows.map(toSummary));
      }
      return summaries;
    });
  }

  async updateIfVersion(
    memo: Memo,
    expectedVersion: Version,
  ): Promise<Result<UpdateOutcome, RepositoryError>> {
    const version = decodeVersion(expectedVersion);
    if (version === undefined) return ok({ kind: "conflict" });

    return this.run(async (): Promise<UpdateOutcome> => {
      // 行がないときも失敗する(作らない)
      const result = await this.client.putIfVersion(this.tableName, toRow(memo), version, {
        timeout: NOSQL_TIMEOUT_MS,
      });
      if (!result.success) return { kind: "conflict" };
      return { kind: "updated", version: requireVersion(result.version) };
    });
  }

  async delete(
    id: MemoId,
    expectedVersion?: Version,
  ): Promise<Result<DeleteOutcome, RepositoryError>> {
    return this.run(async (): Promise<DeleteOutcome> => {
      if (expectedVersion === undefined) {
        const result = await this.client.delete(this.tableName, { id }, {
          timeout: NOSQL_TIMEOUT_MS,
        });
        return result.success ? { kind: "deleted" } : { kind: "not_found" };
      }

      const version = decodeVersion(expectedVersion);
      if (version === undefined) {
        // どの行とも一致しないので削除はしない。not_found と conflict を分けるために行の有無だけを見る
        const found = await this.client.get(this.tableName, { id }, { timeout: NOSQL_TIMEOUT_MS });
        return found.row === null ? { kind: "not_found" } : { kind: "conflict" };
      }

      // バージョンが一致しなかったときだけ、既存の行のバージョンが返る。返らなければ行がない
      const result = await this.client.deleteIfVersion(this.tableName, { id }, version, {
        timeout: NOSQL_TIMEOUT_MS,
        returnExisting: true,
      });
      if (result.success) return { kind: "deleted" };
      return result.existingVersion === undefined ? { kind: "not_found" } : { kind: "conflict" };
    });
  }

  /** 準備した文は使い回す。失敗したら次の呼び出しで準備し直す */
  private prepare(sql: string): Promise<PreparedStatement> {
    let statement = this.prepared.get(sql);
    if (statement === undefined) {
      statement = this.client.prepare(sql, { timeout: NOSQL_TIMEOUT_MS });
      this.prepared.set(sql, statement);
      statement.catch(() => this.prepared.delete(sql));
    }
    return statement;
  }

  /** スロットリングを THROTTLED に変換する。それ以外の失敗は例外のまま投げる(SPEC 9.1) */
  private async run<T>(operation: () => Promise<T>): Promise<Result<T, RepositoryError>> {
    try {
      return ok(await operation());
    } catch (error) {
      if (isThrottling(error)) return err(THROTTLED);
      throw error;
    }
  }
}
