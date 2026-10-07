// GitHub Actions の OIDC トークンを OCI の UPST に交換し、OCI CLI の設定一式を書く(SPEC 10.6)。
// deploy-web.yml から実行する。手元では実行しない(GitHub Actions の環境変数がないと止まる)
//
//   node apps/web/scripts/oci-upst.ts
//
// 交換の手順は OCI Python SDK の TokenExchangeSigner(oci/auth/signers/token_exchange_signer.py。
// OCI CLI 3.92.1 に同梱の SDK で確認)と同じにした。SDK を使わず TypeScript で書くのは、ほかの配置スクリプトと
// 言語・テストの流儀をそろえ、仕組みを読めるようにするため(仮置き)
//   https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/json_web_token_exchange.htm
//   https://docs.github.com/en/actions/reference/security/oidc
//
// 表示してよいのは GitHub のトークンの sub と aud、UPST の exp だけ。
// JWT・UPST・client secret・秘密鍵は表示しない(public リポジトリの Actions のログは誰でも読める)
import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { main } from "./oci-cli.ts";

export type UpstEnv = {
  /** GitHub が渡す、OIDC トークンを取りに行く URL(permissions: id-token: write が要る) */
  requestUrl: string;
  requestToken: string;
  /** アイデンティティドメインの URL(https://idcs-....identity.oraclecloud.com) */
  domainUrl: string;
  /** トークン交換用の confidential app */
  clientId: string;
  clientSecret: string;
  tenancy: string;
  region: string;
  /** 書き出す OCI CLI のプロファイル名 */
  profile: string;
  /** 秘密鍵・トークン・設定ファイルを書くディレクトリ */
  outDir: string;
  /** 省略したら GitHub の既定(リポジトリの所有者の URL) */
  audience: string | undefined;
};

const KEYS = {
  requestUrl: "ACTIONS_ID_TOKEN_REQUEST_URL",
  requestToken: "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  domainUrl: "OCI_DOMAIN_URL",
  clientId: "OCI_TOKEN_EXCHANGE_CLIENT_ID",
  clientSecret: "OCI_TOKEN_EXCHANGE_CLIENT_SECRET",
  tenancy: "OCI_TENANCY_OCID",
  region: "OCI_REGION",
  profile: "OCI_PROFILE",
  outDir: "OCI_UPST_DIR",
} as const;

const AUDIENCE_KEY = "OIDC_AUDIENCE";

/** 足りない値があれば、その名前をすべて挙げて例外を投げる */
export function parseUpstEnv(values: Record<string, string | undefined>): UpstEnv {
  const read = (key: string) => values[key]?.trim() ?? "";
  const missing = Object.values(KEYS).filter((key) => read(key) === "");
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  const domainUrl = read(KEYS.domainUrl);
  // client secret を送る先なので、平文の http は受け付けない
  if (!domainUrl.startsWith("https://")) throw new Error(`${KEYS.domainUrl} must start with https://`);
  const audience = read(AUDIENCE_KEY);
  return {
    requestUrl: read(KEYS.requestUrl),
    requestToken: read(KEYS.requestToken),
    domainUrl,
    clientId: read(KEYS.clientId),
    clientSecret: read(KEYS.clientSecret),
    tenancy: read(KEYS.tenancy),
    region: read(KEYS.region),
    profile: read(KEYS.profile),
    outDir: read(KEYS.outDir),
    audience: audience === "" ? undefined : audience,
  };
}

/** GitHub の URL にはすでにクエリ文字列(api-version)が付いているので、audience は足す */
export function githubOidcRequestUrl(requestUrl: string, audience: string | undefined): string {
  if (audience === undefined) return requestUrl;
  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  return url.toString();
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 応答は {"value": "<JWT>"}。失敗したときも本文はメッセージに入れない */
export function parseGithubOidcResponse(status: number, bodyText: string): string {
  if (status !== 200) throw new Error(`Failed to get the GitHub OIDC token (HTTP ${status})`);
  const value = parseJsonObject(bodyText)?.value;
  if (typeof value !== "string" || value === "") throw new Error("GitHub OIDC response has no value");
  return value;
}

export function tokenEndpoint(domainUrl: string): string {
  return `${domainUrl.replace(/\/+$/, "")}/oauth2/v1/token`;
}

/** SDK と同じく、client_id と client_secret を URL エンコードせずにつなぐ */
export function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

/** public_key は UPST の jwk claim に入り、対応する秘密鍵で OCI API の署名をする */
export function exchangeRequestBody(jwt: string, publicKey: string): string {
  return new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:oci:token-type:oci-upst",
    subject_token: jwt,
    subject_token_type: "jwt",
    public_key: publicKey,
  }).toString();
}

/** 応答は {"token": "<UPST>"}。失敗したときは本文の error と error_description だけをメッセージに入れる */
export function parseExchangeResponse(status: number, bodyText: string): string {
  const body = parseJsonObject(bodyText);
  if (status !== 200) {
    const detail = [body?.error, body?.error_description].filter(
      (value): value is string => typeof value === "string" && value !== "",
    );
    const suffix = detail.length > 0 ? `: ${detail.join(": ")}` : "";
    throw new Error(`Token exchange failed (HTTP ${status})${suffix}`);
  }
  const token = body?.token;
  if (typeof token !== "string" || token === "") throw new Error("Token exchange response has no token");
  return token;
}

const PEM_HEADER = "-----BEGIN PUBLIC KEY-----";
const PEM_FOOTER = "-----END PUBLIC KEY-----";

/** SPKI の PEM から BEGIN / END の行と改行を除いた本体(base64)。SDK が public_key に渡す形 */
export function publicKeyBody(pem: string): string {
  if (!pem.includes(PEM_HEADER) || !pem.includes(PEM_FOOTER)) throw new Error("Not an SPKI public key PEM");
  return pem.replace(PEM_HEADER, "").replace(PEM_FOOTER, "").replace(/\s+/g, "");
}

/** OCI CLI と同じ fingerprint(公開鍵の DER の MD5 を、2 桁ずつコロンで区切る) */
export function fingerprintOf(publicKeyBase64: string): string {
  const hex = createHash("md5").update(Buffer.from(publicKeyBase64, "base64")).digest("hex");
  return hex.match(/../g)?.join(":") ?? "";
}

export type OciConfig = {
  profile: string;
  fingerprint: string;
  keyFile: string;
  tenancy: string;
  region: string;
  securityTokenFile: string;
};

/** oci session authenticate が書くのと同じ項目・順序。user は書かない(UPST で認証する) */
export function ociConfigText(config: OciConfig): string {
  return [
    `[${config.profile}]`,
    `fingerprint=${config.fingerprint}`,
    `key_file=${config.keyFile}`,
    `tenancy=${config.tenancy}`,
    `region=${config.region}`,
    `security_token_file=${config.securityTokenFile}`,
    "",
  ].join("\n");
}

/** 表示のために payload を取り出す。署名は検証しない。失敗してもトークンはメッセージに入れない */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  const payload = parts.length === 3 ? parts[1] : undefined;
  if (payload === undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("Not a JWT");
  const decoded = parseJsonObject(Buffer.from(payload, "base64url").toString("utf8"));
  if (decoded === undefined) throw new Error("Not a JWT");
  return decoded;
}

function claimText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(",");
  return "(none)";
}

/** Identity Propagation Trust の rule と照らし合わせるために、sub と aud を出す */
export function describeGithubToken(payload: Record<string, unknown>): string {
  return `GitHub OIDC token: sub=${claimText(payload.sub)} aud=${claimText(payload.aud)}`;
}

/** UPST の有効期限は公式文書に記載がないので、毎回表示して確かめる(SPEC 13 章) */
export function describeUpstExpiry(payload: Record<string, unknown>, nowMs: number): string {
  if (typeof payload.exp !== "number") return "UPST has no exp claim";
  const expMs = payload.exp * 1000;
  const minutes = Math.round((expMs - nowMs) / 60_000);
  return `UPST expires at ${new Date(expMs).toISOString()} (in ${minutes} min)`;
}

export async function fetchGithubOidcToken(env: UpstEnv, fetchFn: typeof fetch): Promise<string> {
  const response = await fetchFn(githubOidcRequestUrl(env.requestUrl, env.audience), {
    method: "GET",
    headers: { Authorization: `Bearer ${env.requestToken}` },
  });
  return parseGithubOidcResponse(response.status, await response.text());
}

export async function exchangeForUpst(
  env: UpstEnv,
  jwt: string,
  publicKey: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const response = await fetchFn(tokenEndpoint(env.domainUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthorization(env.clientId, env.clientSecret),
    },
    body: exchangeRequestBody(jwt, publicKey),
  });
  return parseExchangeResponse(response.status, await response.text());
}

/** 自分だけが読み書きできるファイルにする(既にあっても権限を付け直す) */
function writePrivateFile(path: string, data: string): void {
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** GitHub Actions のログで、値を *** に置き換えさせる */
function mask(value: string): void {
  console.log(`::add-mask::${value}`);
}

if (import.meta.main) {
  await main(async () => {
    const env = parseUpstEnv(process.env);

    const jwt = await fetchGithubOidcToken(env, fetch);
    mask(jwt);
    console.log(describeGithubToken(decodeJwtPayload(jwt)));

    // 鍵ペアは実行のたびに作り、ディスクには秘密鍵だけを書く(SDK の SessionKeySupplier と同じ RSA 2048 ビット)
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const publicKeyBase64 = publicKeyBody(publicKey);

    const upst = await exchangeForUpst(env, jwt, publicKeyBase64, fetch);
    mask(upst);
    console.log(describeUpstExpiry(decodeJwtPayload(upst), Date.now()));

    const outDir = resolve(env.outDir);
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const keyFile = join(outDir, "oci_api_key.pem");
    const securityTokenFile = join(outDir, "token");
    const configFile = join(outDir, "config");
    writePrivateFile(keyFile, privateKey);
    writePrivateFile(securityTokenFile, upst);
    writePrivateFile(
      configFile,
      ociConfigText({
        profile: env.profile,
        fingerprint: fingerprintOf(publicKeyBase64),
        keyFile,
        tenancy: env.tenancy,
        region: env.region,
        securityTokenFile,
      }),
    );
    console.log(`# OCI CLI の設定を書きました: ${configFile}(プロファイル ${env.profile})`);
  });
}
