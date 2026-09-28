import { describe, expect, it } from "vitest";
import { isMemoId } from "./id";

describe("isMemoId", () => {
  it("ULID の形式(26 文字、Crockford Base32、大文字)を受け付ける", () => {
    expect(isMemoId("01J8Z3K5Q7W9X2Y4Z6A8B0C2D4")).toBe(true);
  });

  it.each([
    ["小文字", "01j8z3k5q7w9x2y4z6a8b0c2d4"],
    ["25 文字", "01J8Z3K5Q7W9X2Y4Z6A8B0C2D"],
    ["27 文字", "01J8Z3K5Q7W9X2Y4Z6A8B0C2D45"],
    ["I を含む", "01J8Z3K5Q7W9X2Y4Z6A8B0C2DI"],
    ["L を含む", "01J8Z3K5Q7W9X2Y4Z6A8B0C2DL"],
    ["O を含む", "01J8Z3K5Q7W9X2Y4Z6A8B0C2DO"],
    ["U を含む", "01J8Z3K5Q7W9X2Y4Z6A8B0C2DU"],
    ["空文字", ""],
  ])("%s は受け付けない", (_label, value) => {
    expect(isMemoId(value)).toBe(false);
  });
});
