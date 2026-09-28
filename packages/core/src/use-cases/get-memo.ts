import type { NotFound, Throttled } from "../errors";
import { isMemoId } from "../id";
import type { VersionedMemo } from "../memo";
import type { MemoRepository } from "../ports";
import { err, ok, type Result } from "../result";

export async function getMemo(
  deps: { repository: MemoRepository },
  id: string,
): Promise<Result<VersionedMemo, NotFound | Throttled>> {
  // 形式が不正な id と存在しない id は区別しない
  if (!isMemoId(id)) return err({ code: "NOT_FOUND" });

  const found = await deps.repository.findById(id);
  if (!found.ok) return found;
  if (found.value === null) return err({ code: "NOT_FOUND" });
  return ok(found.value);
}
