import { BODY_MAX_BYTES, TITLE_MAX_LENGTH } from "@memo/core";
import { describe, expect, it } from "vitest";
import { buildPatch, checkDraft, draftToClipboardText, isDirty, remainingBodyBytes } from "./memo-form";

describe("remainingBodyBytes", () => {
  it("空なら上限のバイト数がそのまま残る", () => {
    expect(remainingBodyBytes("")).toBe(BODY_MAX_BYTES);
  });

  it("UTF-8 のバイト数で数える(ASCII は 1、ひらがなは 3、絵文字は 4)", () => {
    expect(remainingBodyBytes("abc")).toBe(BODY_MAX_BYTES - 3);
    expect(remainingBodyBytes("あ")).toBe(BODY_MAX_BYTES - 3);
    expect(remainingBodyBytes("😀")).toBe(BODY_MAX_BYTES - 4);
  });

  it("上限ちょうどで 0、超えると負の数", () => {
    expect(remainingBodyBytes("a".repeat(BODY_MAX_BYTES))).toBe(0);
    expect(remainingBodyBytes("a".repeat(BODY_MAX_BYTES) + "あ")).toBe(-3);
  });
});

describe("checkDraft", () => {
  it("正しい入力ならエラーなし", () => {
    expect(checkDraft({ title: "買い物", body: "" })).toEqual([]);
  });

  it("空白だけの title は BLANK", () => {
    expect(checkDraft({ title: " \n", body: "" })).toEqual([{ field: "title", reason: "BLANK" }]);
  });

  it("title はコードポイント数で上限を判定する", () => {
    expect(checkDraft({ title: "😀".repeat(TITLE_MAX_LENGTH), body: "" })).toEqual([]);
    expect(checkDraft({ title: "😀".repeat(TITLE_MAX_LENGTH + 1), body: "" })).toEqual([
      { field: "title", reason: "TOO_LONG" },
    ]);
  });

  it("body は UTF-8 のバイト数で上限を判定する", () => {
    expect(checkDraft({ title: "t", body: "a".repeat(BODY_MAX_BYTES) })).toEqual([]);
    expect(checkDraft({ title: "t", body: "a".repeat(BODY_MAX_BYTES + 1) })).toEqual([
      { field: "body", reason: "TOO_LONG" },
    ]);
  });

  it("title と body の両方が不正なら両方を返す", () => {
    expect(checkDraft({ title: "", body: "a".repeat(BODY_MAX_BYTES + 1) })).toEqual([
      { field: "title", reason: "BLANK" },
      { field: "body", reason: "TOO_LONG" },
    ]);
  });
});

describe("isDirty", () => {
  const saved = { title: "買い物", body: "牛乳" };

  it("保存した内容と同じなら false", () => {
    expect(isDirty(saved, { title: "買い物", body: "牛乳" })).toBe(false);
  });

  it("title か body が違えば true(前後の空白の違いも変更とみなす)", () => {
    expect(isDirty(saved, { title: "買い物 ", body: "牛乳" })).toBe(true);
    expect(isDirty(saved, { title: "買い物", body: "牛乳\n卵" })).toBe(true);
  });
});

describe("buildPatch", () => {
  const saved = { title: "買い物", body: "牛乳" };

  it("変わったキーだけを入れる", () => {
    expect(buildPatch(saved, { title: "買い物リスト", body: "牛乳" })).toEqual({ title: "買い物リスト" });
    expect(buildPatch(saved, { title: "買い物", body: "" })).toEqual({ body: "" });
    expect(buildPatch(saved, { title: "a", body: "b" })).toEqual({ title: "a", body: "b" });
  });

  it("何も変わっていなければ undefined(PATCH の {} は 400 になるので送らない)", () => {
    expect(buildPatch(saved, { ...saved })).toBeUndefined();
  });
});

describe("draftToClipboardText", () => {
  it("title と body を空行で区切ってつなげる", () => {
    expect(draftToClipboardText({ title: "買い物", body: "牛乳\n卵" })).toBe("買い物\n\n牛乳\n卵");
  });
});
