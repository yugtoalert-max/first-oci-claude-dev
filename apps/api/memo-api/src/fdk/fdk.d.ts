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
    readonly httpGateway: HTTPGatewayContext;
  };

  export function handle(
    fn: (input: string, ctx: Context) => unknown,
    options: { inputMode: "string" },
  ): () => void;
}
