// アダプター層の入出力。FDK に依存しない形にしておき、FDK との接続は別のファイルで行う

export type HttpHeaders = Record<string, string | string[] | undefined>;

export type HttpRequest = {
  /** ログに出すリクエスト ID */
  requestId: string;
  method: string;
  /** パスとクエリ文字列(例: /api/memos?limit=20) */
  url: string;
  /** ヘッダー名の大文字・小文字は区別しない */
  headers: HttpHeaders;
  /** ボディがなければ空文字 */
  body: string;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  /** 204 では空文字 */
  body: string;
};
