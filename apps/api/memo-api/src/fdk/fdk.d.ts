// @fnproject/fdk には型定義がないので、使う部分だけを宣言する(fn-fdk.js の Context / HTTPGatewayContext)
declare module "@fnproject/fdk" {
  export type HTTPGatewayContext = {
    readonly requestURL: string | null;
    readonly method: string | null;
    readonly headers: Record<string, string[]>;
    statusCode: number | string | null;
    setResponseHeader(key: string, ...values: string[]): void;
  };

  export type Context = {
    readonly callID: string | null;
    readonly headers: Record<string, string[]>;
    readonly httpGateway: HTTPGatewayContext;
  };

  /** FDK が writeResult でそのまま書き出す結果(fn-fdk.js の RawResult) */
  export type RawResult = {
    writeResult(ctx: unknown, resp: { write(chunk: string): boolean }): void;
  };

  export function rawResult(res: string): RawResult;

  export function handle(
    fn: (input: string, ctx: Context) => unknown,
    options: { inputMode: "string" },
  ): () => void;
}
