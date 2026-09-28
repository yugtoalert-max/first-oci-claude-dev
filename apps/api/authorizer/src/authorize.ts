// API Gateway の authorizer Function(複数引数)の入出力
// https://docs.oracle.com/en-us/iaas/Content/APIGateway/Tasks/apigatewayusingauthorizerfunction_topic-Creating_an_Authorizer_Function.htm
import { extractBearerToken, tokensMatch } from "./bearer";

/**
 * API Gateway のデプロイメントの authorizer の parameters で、
 * request.headers[Authorization] を渡す引数の名前。デプロイメントの設定と合わせる
 */
export const AUTHORIZATION_ARGUMENT = "authorization";

/** 認証に成功したときの結果を API Gateway がキャッシュする時間(SPEC 7 章) */
export const AUTH_RESULT_TTL_MS = 5 * 60 * 1000;

/**
 * 成功: active と、結果をキャッシュしてよい期限(expiresAt、ISO 8601)。API Gateway は 60 秒〜1 時間の範囲で使う。
 * 失敗: active: false と、API Gateway が 401 に付ける WWW-Authenticate の値。
 * どちらも HTTP 200 で返す。例外を投げると FDK が 5xx を返し、API Gateway はクライアントに 502 を返す
 */
export type AuthorizerResponse =
  | { active: true; expiresAt: string }
  | { active: false; wwwAuthenticate: string };

export type AuthorizerDeps = {
  /** 照合に使うトークン(Vault のシークレットの値) */
  getExpectedToken: () => Promise<string>;
  now: () => Date;
};

const REJECTED: AuthorizerResponse = { active: false, wwwAuthenticate: "Bearer" };

/** 32 バイト以上の乱数を base64url にしたもの(SPEC 7 章)。32 バイトは 43 文字 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * API Gateway が送る { type: "USER_DEFINED", data: { authorization: "..." } } から Authorization を取り出す。
 * 元のリクエストにヘッダーがなければ、引数は data に入らない
 */
function authorizationOf(input: unknown): unknown {
  if (!isRecord(input) || input.type !== "USER_DEFINED" || !isRecord(input.data)) return undefined;
  return input.data[AUTHORIZATION_ARGUMENT];
}

export function createAuthorizer(deps: AuthorizerDeps): (input: unknown) => Promise<AuthorizerResponse> {
  return async (input) => {
    const presented = extractBearerToken(authorizationOf(input));
    if (presented === undefined) return REJECTED;

    const expected = await deps.getExpectedToken();
    // 空や短い値を登録すると誰でも・簡単に通りうるので、設定の誤りとして止める。値はメッセージに含めない
    if (!TOKEN_PATTERN.test(expected)) throw new Error("secret value is not a valid token");

    if (!tokensMatch(presented, expected)) return REJECTED;
    return {
      active: true,
      expiresAt: new Date(deps.now().getTime() + AUTH_RESULT_TTL_MS).toISOString(),
    };
  };
}
