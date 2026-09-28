import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  return atob(text.replace(/-/g, "+").replace(/_/g, "/"));
}

describe("encodeCursor", () => {
  it("base64url(JSON.stringify({ v: 1, after })) の形にする", () => {
    const cursor = encodeCursor(ID);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(fromBase64Url(cursor))).toEqual({ v: 1, after: ID });
  });
});

describe("decodeCursor", () => {
  it("encodeCursor の結果から after を取り出す", () => {
    expect(decodeCursor(encodeCursor(ID))).toBe(ID);
  });

  it.each([
    ["空文字", ""],
    ["base64url でない", "!!!"],
    ["JSON でない", toBase64Url("not json")],
    ["null", toBase64Url("null")],
    ["配列", toBase64Url(`["${ID}"]`)],
    ["v が 1 でない", toBase64Url(JSON.stringify({ v: 2, after: ID }))],
    ["after がない", toBase64Url(JSON.stringify({ v: 1 }))],
    ["after が文字列でない", toBase64Url(JSON.stringify({ v: 1, after: 1 }))],
    ["after が ULID の形式でない", toBase64Url(JSON.stringify({ v: 1, after: ID.toLowerCase() }))],
  ])("%s は復号できない(undefined を返す)", (_label, cursor) => {
    expect(decodeCursor(cursor)).toBeUndefined();
  });
});
