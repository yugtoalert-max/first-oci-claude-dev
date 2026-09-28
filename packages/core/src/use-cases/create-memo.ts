import type { Throttled, ValidationFailed } from "../errors";
import type { Memo, VersionedMemo } from "../memo";
import type { Clock, IdGenerator, MemoRepository } from "../ports";
import { err, ok, type Result } from "../result";
import { validateCreateMemoInput } from "../validation";

export async function createMemo(
  deps: { repository: MemoRepository; clock: Clock; idGenerator: IdGenerator },
  input: unknown,
): Promise<Result<VersionedMemo, ValidationFailed | Throttled>> {
  const validated = validateCreateMemoInput(input);
  if (!validated.ok) return err({ code: "VALIDATION_FAILED", errors: validated.error });

  // createdAt と ULID の時刻部分は、同じ Clock から得た同じ時刻で作る
  const now = deps.clock.now();
  const memo: Memo = {
    id: deps.idGenerator.generate(now),
    title: validated.value.title,
    body: validated.value.body,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await deps.repository.insert(memo);
  if (!inserted.ok) return inserted;
  return ok({ memo, version: inserted.value });
}
