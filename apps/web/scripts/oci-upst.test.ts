import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  basicAuthorization,
  decodeJwtPayload,
  describeGithubToken,
  describeUpstExpiry,
  exchangeForUpst,
  exchangeRequestBody,
  fetchGithubOidcToken,
  fingerprintOf,
  githubOidcRequestUrl,
  ociConfigText,
  parseExchangeResponse,
  parseGithubOidcResponse,
  parseUpstEnv,
  publicKeyBody,
  tokenEndpoint,
  type UpstEnv,
} from "./oci-upst.ts";

const ENV_VALUES = {
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example.test/oidc?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
  OCI_DOMAIN_URL: "https://idcs-example.identity.example.test",
  OCI_TOKEN_EXCHANGE_CLIENT_ID: "client-id",
  OCI_TOKEN_EXCHANGE_CLIENT_SECRET: "client-secret",
  OCI_TENANCY_OCID: "tenancy-ocid",
  OCI_REGION: "region-1",
  OCI_PROFILE: "GITHUB_ACTIONS",
  OCI_UPST_DIR: "/tmp/runner/oci",
};

const ENV: UpstEnv = {
  requestUrl: ENV_VALUES.ACTIONS_ID_TOKEN_REQUEST_URL,
  requestToken: "request-token",
  domainUrl: ENV_VALUES.OCI_DOMAIN_URL,
  clientId: "client-id",
  clientSecret: "client-secret",
  tenancy: "tenancy-ocid",
  region: "region-1",
  profile: "GITHUB_ACTIONS",
  outDir: "/tmp/runner/oci",
  audience: undefined,
};

/** 署名は検証しないので、ヘッダーと署名は形だけ */
function fakeJwt(payload: Record<string, unknown>): string {
  return ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");
}

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(status: number, body: string): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body, { status });
  };
  return { fetch: fn as typeof fetch, calls };
}

describe("parseUpstEnv", () => {
  it("環境変数から設定を作る。OIDC_AUDIENCE は省略できる", () => {
    expect(parseUpstEnv(ENV_VALUES)).toEqual(ENV);
    expect(parseUpstEnv({ ...ENV_VALUES, OIDC_AUDIENCE: " my-aud " }).audience).toBe("my-aud");
    expect(parseUpstEnv({ ...ENV_VALUES, OIDC_AUDIENCE: "" }).audience).toBeUndefined();
  });

  it("足りない(未設定・空)値があれば、その名前をすべて挙げて例外を投げる", () => {
    expect(() => parseUpstEnv({ OCI_REGION: "region-1", OCI_PROFILE: " " })).toThrow(
      "Missing environment variables: ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN, " +
        "OCI_DOMAIN_URL, OCI_TOKEN_EXCHANGE_CLIENT_ID, OCI_TOKEN_EXCHANGE_CLIENT_SECRET, OCI_TENANCY_OCID, " +
        "OCI_PROFILE, OCI_UPST_DIR",
    );
  });

  it("ドメインの URL が https でなければ例外", () => {
    expect(() => parseUpstEnv({ ...ENV_VALUES, OCI_DOMAIN_URL: "http://idcs-example.test" })).toThrow(
      "OCI_DOMAIN_URL must start with https://",
    );
  });
});

describe("githubOidcRequestUrl", () => {
  it("audience がなければ URL をそのまま使う", () => {
    expect(githubOidcRequestUrl(ENV.requestUrl, undefined)).toBe(ENV.requestUrl);
  });

  it("audience があれば、既存のクエリ文字列に足す", () => {
    expect(githubOidcRequestUrl(ENV.requestUrl, "a b")).toBe(
      "https://token.example.test/oidc?api-version=2.0&audience=a+b",
    );
  });
});

describe("parseGithubOidcResponse", () => {
  it("value を返す", () => {
    expect(parseGithubOidcResponse(200, JSON.stringify({ value: "jwt" }))).toBe("jwt");
  });

  it("失敗の応答、value のない応答は例外。本文は含めない", () => {
    expect(() => parseGithubOidcResponse(403, "secret-ish body")).toThrow(
      "Failed to get the GitHub OIDC token (HTTP 403)",
    );
    expect(() => parseGithubOidcResponse(403, "secret-ish body")).not.toThrow(/secret-ish/);
    expect(() => parseGithubOidcResponse(200, "{}")).toThrow("GitHub OIDC response has no value");
    expect(() => parseGithubOidcResponse(200, "not json")).toThrow("GitHub OIDC response has no value");
  });
});

describe("tokenEndpoint", () => {
  it("ドメインの URL の末尾の / を除いて /oauth2/v1/token を付ける", () => {
    expect(tokenEndpoint("https://idcs-example.test")).toBe("https://idcs-example.test/oauth2/v1/token");
    expect(tokenEndpoint("https://idcs-example.test//")).toBe("https://idcs-example.test/oauth2/v1/token");
  });
});

describe("basicAuthorization", () => {
  it("client_id:client_secret を base64 にする", () => {
    // printf 'client-id:s3cr3t:x' | base64
    expect(basicAuthorization("client-id", "s3cr3t:x")).toBe("Basic Y2xpZW50LWlkOnMzY3IzdDp4");
  });
});

describe("exchangeRequestBody", () => {
  it("トークン交換の本文(form)を組み立てる", () => {
    const params = new URLSearchParams(exchangeRequestBody("a.b.c", "MIIB+/="));
    expect(Object.fromEntries(params)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:oci:token-type:oci-upst",
      subject_token: "a.b.c",
      subject_token_type: "jwt",
      public_key: "MIIB+/=",
    });
  });
});

describe("parseExchangeResponse", () => {
  it("token を返す", () => {
    expect(parseExchangeResponse(200, JSON.stringify({ token: "upst" }))).toBe("upst");
  });

  it("エラーの応答は、error と error_description だけを含めて例外を投げる", () => {
    const body = JSON.stringify({
      error: "invalid_grant",
      error_description: "subject token is invalid",
      echoed: "client-secret",
    });
    expect(() => parseExchangeResponse(400, body)).toThrow(
      "Token exchange failed (HTTP 400): invalid_grant: subject token is invalid",
    );
    expect(() => parseExchangeResponse(400, body)).not.toThrow(/client-secret/);
  });

  it("本文が JSON でない、error がないときは、ステータスだけ", () => {
    expect(() => parseExchangeResponse(502, "<html>")).toThrow(/^Token exchange failed \(HTTP 502\)$/);
    expect(() => parseExchangeResponse(401, "{}")).toThrow(/^Token exchange failed \(HTTP 401\)$/);
  });

  it("200 でも token がなければ例外", () => {
    expect(() => parseExchangeResponse(200, JSON.stringify({ token: "" }))).toThrow(
      "Token exchange response has no token",
    );
    expect(() => parseExchangeResponse(200, "[]")).toThrow("Token exchange response has no token");
  });
});

describe("publicKeyBody", () => {
  it("SPKI の PEM から BEGIN / END の行と改行を除く", () => {
    const pem = "-----BEGIN PUBLIC KEY-----\nMIIB\nIjAN\n-----END PUBLIC KEY-----\n";
    expect(publicKeyBody(pem)).toBe("MIIBIjAN");
  });

  it("node:crypto で作った鍵でも、base64 の本体だけになる", () => {
    const { publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(publicKeyBody(publicKey)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("PUBLIC KEY の PEM でなければ例外", () => {
    expect(() => publicKeyBody("-----BEGIN RSA PUBLIC KEY-----\nAA\n-----END RSA PUBLIC KEY-----")).toThrow(
      "Not an SPKI public key PEM",
    );
  });
});

describe("fingerprintOf", () => {
  it("公開鍵の DER(base64 の本体を戻したもの)の MD5 をコロン区切りにする", () => {
    // printf '\x00\x01\x02' | openssl md5 -c
    expect(fingerprintOf("AAEC")).toBe("b9:5f:67:f6:1e:bb:03:61:96:22:d7:98:f4:5f:c2:d3");
  });
});

describe("ociConfigText", () => {
  it("oci session authenticate が書く形のプロファイルを作る", () => {
    expect(
      ociConfigText({
        profile: "GITHUB_ACTIONS",
        fingerprint: "aa:bb",
        keyFile: "/tmp/runner/oci/oci_api_key.pem",
        tenancy: "tenancy-ocid",
        region: "region-1",
        securityTokenFile: "/tmp/runner/oci/token",
      }),
    ).toBe(
      [
        "[GITHUB_ACTIONS]",
        "fingerprint=aa:bb",
        "key_file=/tmp/runner/oci/oci_api_key.pem",
        "tenancy=tenancy-ocid",
        "region=region-1",
        "security_token_file=/tmp/runner/oci/token",
        "",
      ].join("\n"),
    );
  });
});

describe("decodeJwtPayload", () => {
  it("payload を JSON として取り出す(署名は検証しない)", () => {
    expect(decodeJwtPayload(fakeJwt({ sub: "repo:x", exp: 1 }))).toEqual({ sub: "repo:x", exp: 1 });
  });

  it("JWT の形でなければ例外。トークンをメッセージに含めない", () => {
    expect(() => decodeJwtPayload("opaque-token")).toThrow(/^Not a JWT$/);
    expect(() => decodeJwtPayload("a.!!!.c")).toThrow(/^Not a JWT$/);
    expect(() => decodeJwtPayload(`a.${Buffer.from("[1]").toString("base64url")}.c`)).toThrow(/^Not a JWT$/);
  });
});

describe("describeGithubToken", () => {
  it("sub と aud を表示用の文字列にする", () => {
    expect(describeGithubToken({ sub: "repo:o@1/r@2:environment:stg", aud: "https://github.com/o" })).toBe(
      "GitHub OIDC token: sub=repo:o@1/r@2:environment:stg aud=https://github.com/o",
    );
    expect(describeGithubToken({ aud: ["a", "b"] })).toBe("GitHub OIDC token: sub=(none) aud=a,b");
  });
});

describe("describeUpstExpiry", () => {
  const now = Date.parse("2026-10-07T00:00:00Z");

  it("exp と残り時間(分)を表示用の文字列にする", () => {
    expect(describeUpstExpiry({ exp: now / 1000 + 3600 }, now)).toBe(
      "UPST expires at 2026-10-07T01:00:00.000Z (in 60 min)",
    );
  });

  it("exp がなければ、そう表示する", () => {
    expect(describeUpstExpiry({}, now)).toBe("UPST has no exp claim");
  });
});

describe("fetchGithubOidcToken", () => {
  it("リクエスト用のトークンを Bearer で付けて GET する", async () => {
    const { fetch, calls } = fakeFetch(200, JSON.stringify({ value: "jwt" }));
    await expect(fetchGithubOidcToken({ ...ENV, audience: "aud" }, fetch)).resolves.toBe("jwt");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ENV.requestUrl}&audience=aud`);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer request-token");
  });
});

describe("exchangeForUpst", () => {
  it("ドメインのトークンのエンドポイントに、Basic 認証と form の本文で POST する", async () => {
    const { fetch, calls } = fakeFetch(200, JSON.stringify({ token: "upst" }));
    await expect(exchangeForUpst(ENV, "a.b.c", "MIIB", fetch)).resolves.toBe("upst");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(`${ENV.domainUrl}/oauth2/v1/token`);
    expect(call?.init?.method).toBe("POST");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(headers.get("authorization")).toBe(basicAuthorization("client-id", "client-secret"));
    expect(call?.init?.body).toBe(exchangeRequestBody("a.b.c", "MIIB"));
  });

  it("失敗の応答は例外", async () => {
    const { fetch } = fakeFetch(401, JSON.stringify({ error: "invalid_client" }));
    await expect(exchangeForUpst(ENV, "a.b.c", "MIIB", fetch)).rejects.toThrow(
      "Token exchange failed (HTTP 401): invalid_client",
    );
  });
});
