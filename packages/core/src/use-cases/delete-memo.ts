import type { NotFound, PreconditionFailed, Throttled } from "../errors";
import { isMemoId } from "../id";
import type { Version } from "../memo";
import type { MemoRepository } from "../ports";
import { err, ok, type Result } from "../result";

export async function deleteMemo(
  deps: { repository: MemoRepository },
  command: { id: string; expectedVersion?: Version },
): Promise<Result<void, NotFound | PreconditionFailed | Throttled>> {
  if (!isMemoId(command.id)) return err({ code: "NOT_FOUND" });

  // 存在しなければ、バージョンの指定にかかわらず NOT_FOUND(PATCH と同じく 404 を 412 より先に判定する)
  const deleted = await deps.repository.delete(command.id, command.expectedVersion);
  if (!deleted.ok) return deleted;
  switch (deleted.value.kind) {
    case "deleted":
      return ok(undefined);
    case "not_found":
      return err({ code: "NOT_FOUND" });
    case "conflict":
      return err({ code: "PRECONDITION_FAILED" });
  }
}
