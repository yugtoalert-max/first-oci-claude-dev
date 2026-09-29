// FDK(@fnproject/fdk)の HTTP Gateway 経由の呼び出しと、アダプター層(createHandler)をつなぐ。
// FDK は API Gateway のリクエストを Fn-Http-Method / Fn-Http-Request-Url / Fn-Http-H-* のヘッダーで受け取り、
// httpGateway から読めるようにしている。ただし Content-Type などは Fn-Http-H- が付かず、
// 呼び出しそのもののヘッダー(ctx.headers)として届く。レスポンスのステータスとヘッダーは httpGateway に設定する
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
 * 呼び出しそのもののヘッダー(Fn- で始まるものを除く)と httpGateway.headers を合わせる。
 * 同じ名前が両方にあれば httpGateway 側を使う(API Gateway が受け取ったヘッダーそのもののため)。
 * FDK が両方の名前を先頭大文字の形にそろえるので、名前はそのまま比べる
 */
function mergeHeaders(ctx: FdkContext): Record<string, string[]> {
  const invocation = Object.entries(ctx.headers).filter(([key]) => !key.startsWith("Fn-"));
  return { ...Object.fromEntries(invocation), ...ctx.httpGateway.headers };
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
    headers: mergeHeaders(ctx),
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

/** 名前を大文字・小文字を区別せずに探す。なければ null */
function valuesOf(headers: Record<string, string[]>, name: string): string[] | null {
  const lower = name.toLowerCase();
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
  return found ? found[1] : null;
}

function describeHeaders(headers: Record<string, string[]>) {
  return {
    names: Object.keys(headers).sort(),
    contentType: valuesOf(headers, "Content-Type"),
    ifMatch: valuesOf(headers, "If-Match"),
  };
}

/**
 * 一時的な診断(SPEC 13 章の 16)。どのヘッダーがどちらの経路で届くかを調べるため、
 * 両方のヘッダーの名前と、Content-Type・If-Match の値だけを返す(Authorization などの値は出さない)。
 * 原因がわかったら外す
 */
export function describeRequestHeaders(ctx: FdkContext) {
  return {
    diagnostic: "request-headers",
    requestId: ctx.callID,
    invocation: describeHeaders(ctx.headers),
    gateway: describeHeaders(ctx.httpGateway.headers),
  };
}

/**
 * fdk.handle に渡す関数を作る。入力は文字列で受け取る(inputMode: "string")。
 * ボディは rawResult で返す。文字列のまま返すと、FDK は応答の Content-Type が JSON のとき
 * もう一度 JSON.stringify してから書き出すため(ボディが JSON の文字列リテラルになる)
 */
export function createFdkHandler(
  handle: Handler,
  options: { logDiagnostic?: (line: string) => void } = {},
): (body: string, ctx: FdkContext) => Promise<RawResult> {
  return async (body, ctx) => {
    options.logDiagnostic?.(JSON.stringify(describeRequestHeaders(ctx)));
    const response = await handle(toHttpRequest(body, ctx));
    return rawResult(writeHttpResponse(response, ctx.httpGateway));
  };
}
