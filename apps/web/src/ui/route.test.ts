import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "./route";

const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";

describe("parseRoute", () => {
  it.each(["", "#", "#/"])("%j は一覧", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "list" });
  });

  it("#/memos/new は新規作成", () => {
    expect(parseRoute("#/memos/new")).toEqual({ name: "new" });
  });

  it("#/memos/{id} は詳細", () => {
    expect(parseRoute(`#/memos/${ID}`)).toEqual({ name: "detail", id: ID });
  });

  it("id はパーセントエンコードを戻してから判定する", () => {
    expect(parseRoute(`#/memos/${encodeURIComponent(ID)}`)).toEqual({ name: "detail", id: ID });
  });

  it.each([
    ["ULID の形式でない id", "#/memos/abc"],
    ["小文字の ULID", `#/memos/${ID.toLowerCase()}`],
    ["末尾の /", `#/memos/${ID}/`],
    ["#/memos だけ", "#/memos"],
    ["知らないパス", "#/settings"],
    ["# のあとが / で始まらない", "#memos/new"],
    ["壊れたパーセントエンコード", "#/memos/%E0%A4%A"],
  ])("%s は not_found", (_, hash) => {
    expect(parseRoute(hash)).toEqual({ name: "not_found" });
  });
});

describe("routeHash", () => {
  it("一覧・新規作成・詳細のハッシュを作る", () => {
    expect(routeHash({ name: "list" })).toBe("#/");
    expect(routeHash({ name: "new" })).toBe("#/memos/new");
    expect(routeHash({ name: "detail", id: ID })).toBe(`#/memos/${ID}`);
  });

  it("作ったハッシュは parseRoute で元に戻る", () => {
    for (const route of [{ name: "list" }, { name: "new" }, { name: "detail", id: ID }] as const) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
  });
});
