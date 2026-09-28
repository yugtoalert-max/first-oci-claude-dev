import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./base-url";

describe("resolveApiBaseUrl", () => {
  it("本番のビルドでは相対パス /api を使う", () => {
    expect(resolveApiBaseUrl({ PROD: true })).toBe("/api");
  });

  it("本番のビルドでは VITE_API_BASE_URL があっても使わない(.env がビルドに混ざっても /api のまま)", () => {
    expect(resolveApiBaseUrl({ PROD: true, VITE_API_BASE_URL: "https://stg.example.test/api" })).toBe(
      "/api",
    );
  });

  it("開発では VITE_API_BASE_URL を使う", () => {
    expect(resolveApiBaseUrl({ PROD: false, VITE_API_BASE_URL: "https://stg.example.test/api" })).toBe(
      "https://stg.example.test/api",
    );
  });

  it("開発では末尾の / を取り除く", () => {
    expect(resolveApiBaseUrl({ PROD: false, VITE_API_BASE_URL: "https://stg.example.test/api/" })).toBe(
      "https://stg.example.test/api",
    );
  });

  it("開発で VITE_API_BASE_URL がない、または空なら例外を投げる(黙って /api にしない)", () => {
    expect(() => resolveApiBaseUrl({ PROD: false })).toThrow(/VITE_API_BASE_URL/);
    expect(() => resolveApiBaseUrl({ PROD: false, VITE_API_BASE_URL: " " })).toThrow(
      /VITE_API_BASE_URL/,
    );
  });
});
