import { ServiceType } from "oracle-nosqldb";
import { describe, expect, it } from "vitest";
import { cloudNoSqlConfig, NOSQL_TIMEOUT_MS } from "./nosql-config";

// 設定を作るだけで、クライアントは作らない(クラウドへは接続しない)

describe("cloudNoSqlConfig", () => {
  it("リソースプリンシパルで、指定したコンパートメントのクラウドに接続する設定を作る", () => {
    expect(cloudNoSqlConfig({ compartment: "<compartment-ocid>" })).toEqual({
      serviceType: ServiceType.CLOUD,
      compartment: "<compartment-ocid>",
      auth: { iam: { useResourcePrincipal: true } },
      timeout: NOSQL_TIMEOUT_MS,
    });
  });

  it("リトライ込みの打ち切り時間は 5 秒", () => {
    expect(cloudNoSqlConfig({ compartment: "<compartment-ocid>" }).timeout).toBe(5000);
  });
});
