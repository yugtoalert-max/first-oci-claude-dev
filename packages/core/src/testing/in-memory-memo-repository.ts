import type { Memo, MemoId, MemoSummary, Version, VersionedMemo } from "../memo";
import type { DeleteOutcome, MemoRepository, RepositoryError, UpdateOutcome } from "../ports";
import { err, ok, type Result } from "../result";

const THROTTLED = { code: "THROTTLED" } as const;

function copy(memo: Memo): Memo {
  return { ...memo, createdAt: new Date(memo.createdAt), updatedAt: new Date(memo.updatedAt) };
}

/**
 * テスト用のインメモリ実装。
 * 行バージョンは「書き込むたびに変わる opaque な文字列」として再現する(SPEC 9.3)
 */
export class InMemoryMemoRepository implements MemoRepository {
  /** true にすると、すべての操作が THROTTLED を返す */
  throttled = false;

  private readonly rows = new Map<MemoId, VersionedMemo>();
  private writes = 0;

  private nextVersion(): Version {
    this.writes += 1;
    return `in-memory-v${this.writes}`;
  }

  async insert(memo: Memo): Promise<Result<Version, RepositoryError>> {
    if (this.throttled) return err(THROTTLED);
    if (this.rows.has(memo.id)) throw new Error(`duplicate id: ${memo.id}`);

    const version = this.nextVersion();
    this.rows.set(memo.id, { memo: copy(memo), version });
    return ok(version);
  }

  async findById(id: MemoId): Promise<Result<VersionedMemo | null, RepositoryError>> {
    if (this.throttled) return err(THROTTLED);

    const row = this.rows.get(id);
    return ok(row ? { memo: copy(row.memo), version: row.version } : null);
  }

  async list(query: {
    after?: MemoId;
    limit: number;
  }): Promise<Result<MemoSummary[], RepositoryError>> {
    if (this.throttled) return err(THROTTLED);

    const { after } = query;
    const summaries = [...this.rows.values()]
      .map(({ memo }) => memo)
      .filter((memo) => after === undefined || memo.id < after)
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, query.limit + 1)
      .map(({ body: _body, ...summary }) => ({
        ...summary,
        createdAt: new Date(summary.createdAt),
        updatedAt: new Date(summary.updatedAt),
      }));
    return ok(summaries);
  }

  async updateIfVersion(
    memo: Memo,
    expectedVersion: Version,
  ): Promise<Result<UpdateOutcome, RepositoryError>> {
    if (this.throttled) return err(THROTTLED);

    const row = this.rows.get(memo.id);
    if (!row || row.version !== expectedVersion) return ok({ kind: "conflict" });

    const version = this.nextVersion();
    this.rows.set(memo.id, { memo: copy(memo), version });
    return ok({ kind: "updated", version });
  }

  async delete(
    id: MemoId,
    expectedVersion?: Version,
  ): Promise<Result<DeleteOutcome, RepositoryError>> {
    if (this.throttled) return err(THROTTLED);

    const row = this.rows.get(id);
    if (!row) return ok({ kind: "not_found" });
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      return ok({ kind: "conflict" });
    }

    this.rows.delete(id);
    return ok({ kind: "deleted" });
  }
}
