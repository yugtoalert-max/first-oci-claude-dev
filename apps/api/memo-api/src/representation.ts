import type { Memo, MemoPage, MemoSummary } from "@memo/core";

// SPEC 4.2: API でのメモの表現。時刻は UTC の ISO 8601(ミリ秒付き)。バージョンはボディに含めない

export function toMemoJson(memo: Memo) {
  return {
    id: memo.id,
    title: memo.title,
    body: memo.body,
    createdAt: memo.createdAt.toISOString(),
    updatedAt: memo.updatedAt.toISOString(),
  };
}

export function toSummaryJson(summary: MemoSummary) {
  return {
    id: summary.id,
    title: summary.title,
    createdAt: summary.createdAt.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
  };
}

export function toPageJson(page: MemoPage) {
  return { items: page.items.map(toSummaryJson), nextCursor: page.nextCursor };
}
