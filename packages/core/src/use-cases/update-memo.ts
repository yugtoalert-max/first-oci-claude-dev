import type { NotFound, PreconditionFailed, Throttled, ValidationFailed } from "../errors";
import { isMemoId } from "../id";
import type { Memo, Version, VersionedMemo } from "../memo";
import type { Clock, MemoRepository } from "../ports";
import { err, ok, type Result } from "../result";
import { validateUpdateMemoInput } from "../validation";

export async function updateMemo(
  deps: { repository: MemoRepository; clock: Clock },
  command: { id: string; input: unknown; expectedVersion: Version },
): Promise<Result<VersionedMemo, ValidationFailed | NotFound | PreconditionFailed | Throttled>> {
  // 判定の順序(SPEC 4.4): id の形式 → 値の検証 → 存在確認 → バージョンの照合
  if (!isMemoId(command.id)) return err({ code: "NOT_FOUND" });

  const validated = validateUpdateMemoInput(command.input);
  if (!validated.ok) return err({ code: "VALIDATION_FAILED", errors: validated.error });

  const found = await deps.repository.findById(command.id);
  if (!found.ok) return found;
  if (found.value === null) return err({ code: "NOT_FOUND" });
  if (found.value.version !== command.expectedVersion) return err({ code: "PRECONDITION_FAILED" });

  // 値が変わらなくても updatedAt を更新する
  const memo: Memo = { ...found.value.memo, ...validated.value, updatedAt: deps.clock.now() };

  const updated = await deps.repository.updateIfVersion(memo, command.expectedVersion);
  if (!updated.ok) return updated;
  if (updated.value.kind === "conflict") return err({ code: "PRECONDITION_FAILED" });
  return ok({ memo, version: updated.value.version });
}
