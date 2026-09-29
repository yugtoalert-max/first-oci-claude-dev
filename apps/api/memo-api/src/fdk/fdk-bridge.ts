// FDK(@fnproject/fdk)の HTTP Gateway 経由の呼び出しと、アダプター層(createHandler)をつなぐ。
// FDK は API Gateway のリクエストを Fn-Http-Method / Fn-Http-Request-Url / Fn-Http-H-* のヘッダーで受け取り、
// httpGateway から読めるようにしている。レスポンスのステータスとヘッダーは httpGateway に設定する
import { type RawResult, rawResult } from "@fnproject/fdk";
import type { createHandler } from "../handler";
import type { HttpRequest, HttpResponse } from "../http";

type Handler = ReturnType<typeof createHandler>;

/** FDK の HTTPGatewayContext のうち、ここで使う部分 */
export type FdkHttpGateway = {
  readonly requestURL: string | null;
  readonly method: string | null;
  /** API Gateway が受け取ったヘッダー。FDK が Fn-Http-H- を外し、名前を先頭大文字の形にそろえたもの */
  readonly headers: Record<string, string[]>;
  statusCode: number | string | null;
  setResponseHeader(key: string, ...values: string[]): void;
};

/** FDK の Context のうち、ここで使う部分 */
export type FdkContext = {
  readonly callID: string | null;
  /** 呼び出しそのもののヘッダー。Fn- で始まる内部用のものも含む。名前は先頭大文字の形にそろっている */
  readonly headers: Record<string, string[]>;
  readonly httpGateway: FdkHttpGateway;
};

function required(value: string | null, name: string): string {
  if (!value) throw new Error(`not an HTTP Gateway invocation: ${name} is missing`);
  return value;
}

/** スキームとホスト付きの URL なら、パスとクエリ文字列だけにする */
function pathAndQuery(url: string): string {
  if (url.startsWith("/")) return url;
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

/**
 * httpGateway.headers の値から、まったく同じ値の重複を除く(順番は最初に出た順)。
 * stg では、クライアントが 1 つだけ送った Content-Type が同じ値 2 つになって届いた(SPEC 13 章の 16)。
 * 値の違う複数行はそのまま渡し、アダプター層で判定する。
 * 呼び出しそのもののヘッダー(ctx.headers)は API Gateway が Function を呼ぶときのものなので使わない
 */
function gatewayHeaders(gateway: FdkHttpGateway): Record<string, string[]> {
  return Object.fromEntries(Object.entries(gateway.headers).map(([key, values]) => [key, [...new Set(values)]]));
}

/**
 * FDK の入力をアダプター層のリクエストにする。
 * リクエスト ID には FDK の呼び出し ID(Fn-Call-Id)を使う(SPEC 9.4)
 */
export function toHttpRequest(body: string, ctx: FdkContext): HttpRequest {
  const gateway = ctx.httpGateway;
  return {
    requestId: required(ctx.callID, "call ID"),
    method: required(gateway.method, "method"),
    url: pathAndQuery(required(gateway.requestURL, "request URL")),
    headers: gatewayHeaders(gateway),
    body,
  };
}

/** アダプター層のレスポンスのステータスとヘッダーを設定し、FDK に返すボディを返す */
export function writeHttpResponse(response: HttpResponse, gateway: FdkHttpGateway): string {
  gateway.statusCode = response.status;
  for (const [key, value] of Object.entries(response.headers)) {
    gateway.setResponseHeader(key, value);
  }
  return response.body;
}

/**
 * fdk.handle に渡す関数を作る。入力は文字列で受け取る(inputMode: "string")。
 * ボディは rawResult で返す。文字列のまま返すと、FDK は応答の Content-Type が JSON のとき
 * もう一度 JSON.stringify してから書き出すため(ボディが JSON の文字列リテラルになる)
 */
export function createFdkHandler(handle: Handler): (body: string, ctx: FdkContext) => Promise<RawResult> {
  return async (body, ctx) => {
    const response = await handle(toHttpRequest(body, ctx));
    return rawResult(writeHttpResponse(response, ctx.httpGateway));
  };
}
