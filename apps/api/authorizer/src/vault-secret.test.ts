import type { requests, responses } from "oci-secrets";
import { describe, expect, it } from "vitest";
import { fetchSecretValue, type SecretsClientPort } from "./vault-secret";

// OCI には接続しない。SDK の SecretsClient をまねた偽物を使う

function fakeClient(content: { contentType: string; content?: string } | undefined) {
  const received: requests.GetSecretBundleRequest[] = [];
  const client: SecretsClientPort = {
    async getSecretBundle(request) {
      received.push(request);
      return {
        etag: "etag",
        opcRequestId: "opc-request-id",
        secretBundle: { secretId: request.secretId, versionNumber: 1, secretBundleContent: content },
      } satisfies responses.GetSecretBundleResponse;
    },
  };
  return { client, received };
}

describe("fetchSecretValue", () => {
  it("シークレットの現在のバージョンを取得し、base64 の中身を UTF-8 の文字列に戻す", async () => {
    const { client, received } = fakeClient({
      contentType: "BASE64",
      content: Buffer.from("token-value", "utf8").toString("base64"),
    });

    expect(await fetchSecretValue(client, "<secret-ocid>")).toBe("token-value");
    expect(received).toEqual([{ secretId: "<secret-ocid>", stage: "CURRENT" }]);
  });

  it.each([
    ["中身がない", undefined],
    ["base64 以外の形式", { contentType: "TEXT", content: "token-value" }],
    ["content がない", { contentType: "BASE64" }],
  ])("取り出せない(%s)ときは例外を投げる", async (_label, content) => {
    const { client } = fakeClient(content);

    await expect(fetchSecretValue(client, "<secret-ocid>")).rejects.toThrow();
  });

  it("取得の失敗はそのまま伝える", async () => {
    const client: SecretsClientPort = {
      getSecretBundle: async () => {
        throw new Error("NotAuthorizedOrNotFound");
      },
    };

    await expect(fetchSecretValue(client, "<secret-ocid>")).rejects.toThrow("NotAuthorizedOrNotFound");
  });
});
