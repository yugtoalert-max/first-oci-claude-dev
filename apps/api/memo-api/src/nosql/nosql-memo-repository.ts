import type {
  DeleteOutcome,
  Memo,
  MemoId,
  MemoRepository,
  MemoSummary,
  RepositoryError,
  Result,
  UpdateOutcome,
  Version,
  VersionedMemo,
} from "@memo/core";
import type { NoSQLClient } from "oracle-nosqldb";

/** リポジトリが使う NoSQL クライアントの操作。テストでは偽物に差し替える */
export type NoSqlClientPort = Pick<
  NoSQLClient,
  "get" | "putIfAbsent" | "putIfVersion" | "delete" | "deleteIfVersion" | "prepare" | "queryIterable"
>;

export class NoSqlMemoRepository implements MemoRepository {
  constructor(_options: { client: NoSqlClientPort; tableName: string }) {}

  async insert(_memo: Memo): Promise<Result<Version, RepositoryError>> {
    throw new Error("not implemented");
  }

  async findById(_id: MemoId): Promise<Result<VersionedMemo | null, RepositoryError>> {
    throw new Error("not implemented");
  }

  async list(_query: {
    after?: MemoId;
    limit: number;
  }): Promise<Result<MemoSummary[], RepositoryError>> {
    throw new Error("not implemented");
  }

  async updateIfVersion(
    _memo: Memo,
    _expectedVersion: Version,
  ): Promise<Result<UpdateOutcome, RepositoryError>> {
    throw new Error("not implemented");
  }

  async delete(
    _id: MemoId,
    _expectedVersion?: Version,
  ): Promise<Result<DeleteOutcome, RepositoryError>> {
    throw new Error("not implemented");
  }
}
