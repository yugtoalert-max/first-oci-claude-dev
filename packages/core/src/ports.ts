import type { Throttled } from "./errors";
import type { Memo, MemoId, MemoSummary, Version, VersionedMemo } from "./memo";
import type { Result } from "./result";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** time を ULID の時刻部分に使う。同じプロセス内では単調増加する */
  generate(time: Date): MemoId;
}

/** リポジトリはスロットリングを Throttled に変換して返す。それ以外の失敗は例外のまま投げる */
export type RepositoryError = Throttled;

export type UpdateOutcome = { kind: "updated"; version: Version } | { kind: "conflict" };

export type DeleteOutcome = { kind: "deleted" } | { kind: "not_found" } | { kind: "conflict" };

export interface MemoRepository {
  insert(memo: Memo): Promise<Result<Version, RepositoryError>>;

  findById(id: MemoId): Promise<Result<VersionedMemo | null, RepositoryError>>;

  /** id の降順で、after より小さい id の要約を limit + 1 件まで返す */
  list(query: { after?: MemoId; limit: number }): Promise<Result<MemoSummary[], RepositoryError>>;

  /** 行のバージョンが expectedVersion と一致するときだけ書き込む。行がなければ conflict */
  updateIfVersion(
    memo: Memo,
    expectedVersion: Version,
  ): Promise<Result<UpdateOutcome, RepositoryError>>;

  /** expectedVersion を省略したら無条件に削除する。行がなければ(バージョンの指定にかかわらず)not_found */
  delete(id: MemoId, expectedVersion?: Version): Promise<Result<DeleteOutcome, RepositoryError>>;
}
