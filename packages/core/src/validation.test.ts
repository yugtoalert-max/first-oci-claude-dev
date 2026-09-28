import { describe, expect, it } from "vitest";
import { BODY_MAX_BYTES, LIST_LIMIT_DEFAULT, TITLE_MAX_LENGTH } from "./constants";
import { encodeCursor } from "./cursor";
import { validateCreateMemoInput, validateListQuery, validateUpdateMemoInput } from "./validation";

const ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4";

describe("入力の上限", () => {
  it("title は 200 文字、body は 16,384 バイト", () => {
    expect(TITLE_MAX_LENGTH).toBe(200);
    expect(BODY_MAX_BYTES).toBe(16_384);
  });
});

describe("validateCreateMemoInput", () => {
  it("title と body を受け付ける", () => {
    expect(validateCreateMemoInput({ title: "買い物", body: "牛乳\n卵" })).toEqual({
      ok: true,
      value: { title: "買い物", body: "牛乳\n卵" },
    });
  });

  it("body を省略したら空文字として扱う", () => {
    expect(validateCreateMemoInput({ title: "買い物" })).toEqual({
      ok: true,
      value: { title: "買い物", body: "" },
    });
  });

  it("前後の空白を除かずにそのまま返す", () => {
    expect(validateCreateMemoInput({ title: "  買い物  ", body: " 牛乳 " })).toEqual({
      ok: true,
      value: { title: "  買い物  ", body: " 牛乳 " },
    });
  });

  it.each([null, [], "title", 1])("オブジェクトでない値(%j)は INVALID_TYPE", (input) => {
    expect(validateCreateMemoInput(input)).toEqual({
      ok: false,
      error: [{ field: "", reason: "INVALID_TYPE" }],
    });
  });

  it("title がなければ REQUIRED", () => {
    expect(validateCreateMemoInput({ body: "牛乳" })).toEqual({
      ok: false,
      error: [{ field: "title", reason: "REQUIRED" }],
    });
  });

  it.each([null, 1, true, {}, []])("文字列でない title(%j)は INVALID_TYPE", (title) => {
    expect(validateCreateMemoInput({ title })).toEqual({
      ok: false,
      error: [{ field: "title", reason: "INVALID_TYPE" }],
    });
  });

  it.each(["", "   ", "\t\n", "　"])("空白だけの title(%j)は BLANK", (title) => {
    expect(validateCreateMemoInput({ title })).toEqual({
      ok: false,
      error: [{ field: "title", reason: "BLANK" }],
    });
  });

  it("title の長さはコードポイント数で数え、200 までは受け付ける", () => {
    // 𠮷 はサロゲートペア(UTF-16 で 2 単位)だが 1 文字として数える
    expect(validateCreateMemoInput({ title: "𠮷".repeat(TITLE_MAX_LENGTH) }).ok).toBe(true);
  });

  it.each([
    ["ASCII", "a".repeat(TITLE_MAX_LENGTH + 1)],
    ["サロゲートペア", "𠮷".repeat(TITLE_MAX_LENGTH + 1)],
  ])("201 文字の title(%s)は TOO_LONG", (_label, title) => {
    expect(validateCreateMemoInput({ title })).toEqual({
      ok: false,
      error: [{ field: "title", reason: "TOO_LONG" }],
    });
  });

  it.each([null, 1, false, {}])("文字列でない body(%j)は INVALID_TYPE", (body) => {
    expect(validateCreateMemoInput({ title: "買い物", body })).toEqual({
      ok: false,
      error: [{ field: "body", reason: "INVALID_TYPE" }],
    });
  });

  it.each([
    ["ASCII", "a".repeat(BODY_MAX_BYTES)],
    ["3 バイト文字 + ASCII", "あ".repeat(5_461) + "a"],
  ])("UTF-8 で 16,384 バイトちょうどの body(%s)は受け付ける", (_label, body) => {
    expect(validateCreateMemoInput({ title: "買い物", body }).ok).toBe(true);
  });

  it.each([
    ["ASCII", "a".repeat(BODY_MAX_BYTES + 1)],
    ["3 バイト文字", "あ".repeat(5_462)],
    ["4 バイト文字", "𠮷".repeat(4_097)],
  ])("UTF-8 で 16,384 バイトを超える body(%s)は TOO_LONG", (_label, body) => {
    expect(validateCreateMemoInput({ title: "買い物", body })).toEqual({
      ok: false,
      error: [{ field: "body", reason: "TOO_LONG" }],
    });
  });

  it("定義していないキーは UNKNOWN_FIELD(field はキーの名前)", () => {
    expect(validateCreateMemoInput({ title: "買い物", tilte: "誤字" })).toEqual({
      ok: false,
      error: [{ field: "tilte", reason: "UNKNOWN_FIELD" }],
    });
  });

  it.each(["id", "createdAt", "updatedAt"])("サーバーが決める %s は指定できない", (key) => {
    expect(validateCreateMemoInput({ title: "買い物", [key]: "x" })).toEqual({
      ok: false,
      error: [{ field: key, reason: "UNKNOWN_FIELD" }],
    });
  });

  it("複数のエラーをまとめて返す", () => {
    const result = validateCreateMemoInput({ title: "", body: 1, extra: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(3);
    expect(result.error).toEqual(
      expect.arrayContaining([
        { field: "title", reason: "BLANK" },
        { field: "body", reason: "INVALID_TYPE" },
        { field: "extra", reason: "UNKNOWN_FIELD" },
      ]),
    );
  });
});

describe("validateUpdateMemoInput", () => {
  it("指定したキーだけを返す", () => {
    expect(validateUpdateMemoInput({ title: "買い物" })).toStrictEqual({
      ok: true,
      value: { title: "買い物" },
    });
    expect(validateUpdateMemoInput({ body: "牛乳" })).toStrictEqual({
      ok: true,
      value: { body: "牛乳" },
    });
    expect(validateUpdateMemoInput({ title: "買い物", body: "牛乳" })).toStrictEqual({
      ok: true,
      value: { title: "買い物", body: "牛乳" },
    });
  });

  it("body の空文字は受け付ける", () => {
    expect(validateUpdateMemoInput({ body: "" })).toStrictEqual({ ok: true, value: { body: "" } });
  });

  it("{} は NO_CHANGES(field は空文字)", () => {
    expect(validateUpdateMemoInput({})).toEqual({
      ok: false,
      error: [{ field: "", reason: "NO_CHANGES" }],
    });
  });

  it.each(["title", "body"])("%s: null は INVALID_TYPE", (key) => {
    expect(validateUpdateMemoInput({ [key]: null })).toEqual({
      ok: false,
      error: [{ field: key, reason: "INVALID_TYPE" }],
    });
  });

  it.each([null, [], "title"])("オブジェクトでない値(%j)は INVALID_TYPE", (input) => {
    expect(validateUpdateMemoInput(input)).toEqual({
      ok: false,
      error: [{ field: "", reason: "INVALID_TYPE" }],
    });
  });

  it("title の規則は作成時と同じ(BLANK / TOO_LONG)", () => {
    expect(validateUpdateMemoInput({ title: " " })).toEqual({
      ok: false,
      error: [{ field: "title", reason: "BLANK" }],
    });
    expect(validateUpdateMemoInput({ title: "a".repeat(TITLE_MAX_LENGTH + 1) })).toEqual({
      ok: false,
      error: [{ field: "title", reason: "TOO_LONG" }],
    });
  });

  it("body の規則は作成時と同じ(TOO_LONG)", () => {
    expect(validateUpdateMemoInput({ body: "a".repeat(BODY_MAX_BYTES + 1) })).toEqual({
      ok: false,
      error: [{ field: "body", reason: "TOO_LONG" }],
    });
  });

  it("定義していないキーだけなら UNKNOWN_FIELD だけを返す", () => {
    expect(validateUpdateMemoInput({ tilte: "誤字" })).toEqual({
      ok: false,
      error: [{ field: "tilte", reason: "UNKNOWN_FIELD" }],
    });
  });
});

describe("validateListQuery", () => {
  it("limit を省略したら既定の 20、cursor を省略したら先頭から", () => {
    expect(LIST_LIMIT_DEFAULT).toBe(20);
    expect(validateListQuery({})).toEqual({ ok: true, value: { limit: 20, after: undefined } });
  });

  it.each([
    ["1", 1],
    ["20", 20],
    ["50", 50],
  ])("limit=%s を受け付ける", (limit, expected) => {
    expect(validateListQuery({ limit })).toEqual({
      ok: true,
      value: { limit: expected, after: undefined },
    });
  });

  it.each(["0", "51", "-1"])("範囲外の limit=%s は OUT_OF_RANGE", (limit) => {
    expect(validateListQuery({ limit })).toEqual({
      ok: false,
      error: [{ field: "limit", reason: "OUT_OF_RANGE" }],
    });
  });

  it.each(["", "abc", "1.5", "1e1", " 1", "+1", "0x10"])(
    "整数でない limit=%j は INVALID_FORMAT",
    (limit) => {
      expect(validateListQuery({ limit })).toEqual({
        ok: false,
        error: [{ field: "limit", reason: "INVALID_FORMAT" }],
      });
    },
  );

  it("cursor から after を取り出す", () => {
    expect(validateListQuery({ cursor: encodeCursor(ID) })).toEqual({
      ok: true,
      value: { limit: 20, after: ID },
    });
  });

  it.each(["", "!!!", "e30"])("復号できない cursor=%j は INVALID_FORMAT", (cursor) => {
    expect(validateListQuery({ cursor })).toEqual({
      ok: false,
      error: [{ field: "cursor", reason: "INVALID_FORMAT" }],
    });
  });

  it("limit と cursor の両方が不正ならまとめて返す", () => {
    const result = validateListQuery({ limit: "0", cursor: "!!!" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2);
    expect(result.error).toEqual(
      expect.arrayContaining([
        { field: "limit", reason: "OUT_OF_RANGE" },
        { field: "cursor", reason: "INVALID_FORMAT" },
      ]),
    );
  });
});
