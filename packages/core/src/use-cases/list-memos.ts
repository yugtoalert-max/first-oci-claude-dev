import { encodeCursor } from "../cursor";
import type { Throttled, ValidationFailed } from "../errors";
import type { MemoSummary } from "../memo";
import type { MemoRepository } from "../ports";
import { err, ok, type Result } from "../result";
import { validateListQuery } from "../validation";

export type MemoPage = {
  items: MemoSummary[];
  /** 最後のページでは null */
  nextCursor: string | null;
};

export async function listMemos(
  deps: { repository: MemoRepository },
  query: { limit?: string; cursor?: string },
): Promise<Result<MemoPage, ValidationFailed | Throttled>> {
  const validated = validateListQuery(query);
  if (!validated.ok) return err({ code: "VALIDATION_FAILED", errors: validated.error });
  const { limit, after } = validated.value;

  // リポジトリは limit + 1 件まで返す。limit + 1 件目があれば次のページがある
  const listed = await deps.repository.list({ after, limit });
  if (!listed.ok) return listed;

  const items = listed.value.slice(0, limit);
  const last = items.at(-1);
  const hasNext = listed.value.length > limit && last !== undefined;
  return ok({ items, nextCursor: hasNext ? encodeCursor(last.id) : null });
}
