/** ULID(26 文字、Crockford Base32、大文字) */
export type MemoId = string;

/** 行バージョン。中身を見ない文字列(opaque)として扱う */
export type Version = string;

export type Memo = {
  id: MemoId;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

/** 一覧の要素。本文を含まない */
export type MemoSummary = Omit<Memo, "body">;

export type VersionedMemo = {
  memo: Memo;
  version: Version;
};
