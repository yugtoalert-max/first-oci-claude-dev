/**
 * シークレットの値の取得を、一定時間キャッシュする(SPEC 7 章)。
 * 取得中に重ねて呼ばれたら同じ取得を待つ。失敗はキャッシュせず、次の呼び出しで取得し直す
 */
export function cacheSecret(options: {
  fetch: () => Promise<string>;
  /** 現在時刻(ms)。実行環境では Date.now */
  now: () => number;
  ttlMs: number;
}): () => Promise<string> {
  let cached: { value: Promise<string>; fetchedAt: number } | undefined;

  return () => {
    const now = options.now();
    if (cached !== undefined && now - cached.fetchedAt < options.ttlMs) return cached.value;

    const entry = { value: options.fetch(), fetchedAt: now };
    cached = entry;
    entry.value.catch(() => {
      if (cached === entry) cached = undefined;
    });
    return entry.value;
  };
}
