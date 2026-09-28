import { describe, expect, it } from "vitest";
import { createTokenStore, normalizeTokenInput, TOKEN_STORAGE_KEY } from "./token-store";

/** sessionStorage の偽物 */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("createTokenStore", () => {
  it("保存したトークンを読み出せる", () => {
    const storage = fakeStorage();
    const store = createTokenStore(storage);
    expect(store.get()).toBeNull();

    store.set("token-1");
    expect(store.get()).toBe("token-1");
    expect(storage.items.get(TOKEN_STORAGE_KEY)).toBe("token-1");
  });

  it("clear でトークンを破棄する", () => {
    const storage = fakeStorage();
    const store = createTokenStore(storage);
    store.set("token-1");

    store.clear();
    expect(store.get()).toBeNull();
    expect(storage.items.has(TOKEN_STORAGE_KEY)).toBe(false);
  });

  it("空文字が保存されていたら、ないものとして扱う", () => {
    const storage = fakeStorage();
    storage.items.set(TOKEN_STORAGE_KEY, "");
    expect(createTokenStore(storage).get()).toBeNull();
  });
});

describe("normalizeTokenInput", () => {
  it("前後の空白や改行を取り除く(貼り付けたときに付きやすいため)", () => {
    expect(normalizeTokenInput("  abc_DEF-123\n")).toBe("abc_DEF-123");
  });

  it("空、または空白だけなら undefined", () => {
    expect(normalizeTokenInput("")).toBeUndefined();
    expect(normalizeTokenInput(" \t\n")).toBeUndefined();
  });
});
