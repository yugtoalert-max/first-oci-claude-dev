// @fnproject/fdk には型定義がないので、使う部分だけを宣言する(fn-fdk.js の handle)
declare module "@fnproject/fdk" {
  /**
   * 既定の inputMode("json")では、ボディを JSON として解析して渡す。解析できなければ文字列のまま渡す。
   * 返したオブジェクトは JSON にして HTTP 200 で返す。例外を投げると 5xx(502)を返す
   */
  export function handle(fn: (input: unknown) => unknown): () => void;
}
