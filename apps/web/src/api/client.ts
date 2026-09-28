import type { ErrorCode, FieldError, Memo, MemoPage, Result } from "@memo/core";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => string;
  fetch?: FetchLike;
};

export type ApiError = {
  status: number;
  code: ErrorCode;
  errors?: FieldError[];
  retryAfterSeconds?: number;
};

export type ApiResult<T> = Result<T, ApiError>;

export type EtaggedMemo = { memo: Memo; etag: string };

export type ApiClient = {
  createMemo(input: { title: string; body?: string }): Promise<ApiResult<EtaggedMemo>>;
  listMemos(query?: { cursor?: string; limit?: number }): Promise<ApiResult<MemoPage>>;
  getMemo(id: string): Promise<ApiResult<EtaggedMemo>>;
  updateMemo(
    id: string,
    etag: string,
    patch: { title?: string; body?: string },
  ): Promise<ApiResult<EtaggedMemo>>;
  deleteMemo(id: string, etag?: string): Promise<ApiResult<void>>;
};

export function createApiClient(_options: ApiClientOptions): ApiClient {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented");
  };
  return {
    createMemo: notImplemented,
    listMemos: notImplemented,
    getMemo: notImplemented,
    updateMemo: notImplemented,
    deleteMemo: notImplemented,
  };
}
