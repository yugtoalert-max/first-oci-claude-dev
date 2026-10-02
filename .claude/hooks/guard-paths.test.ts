import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkPath, type Roots } from "./guard-paths.ts";

let roots: Roots;
let outside: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "guard-paths-"));
  roots = { project: join(base, "repo"), scratchpad: join(base, "scratch"), home: join(base, "home") };
  outside = join(base, "elsewhere");
  for (const d of [join(roots.project, "src"), roots.scratchpad!, outside, join(roots.home, ".claude", "projects", "p", "memory")]) {
    mkdirSync(d, { recursive: true });
  }
  // リポジトリの中に置いた、外を指すシンボリックリンク
  symlinkSync(outside, join(roots.project, "link-out"));
});

describe("checkPath", () => {
  it.each([
    ["相対パス", "src/a.ts"],
    ["まだないディレクトリの中", "src/new/dir/b.ts"],
    ["絶対パス", () => join(roots.project, "README.md")],
    ["一時ディレクトリ", () => join(roots.scratchpad!, "notes.md")],
    ["プロジェクトのメモリ", () => join(roots.home, ".claude", "projects", "p", "memory", "m.md")],
    ["プランファイル", () => join(roots.home, ".claude", "plans", "plan.md")],
  ])("%s は通す", (_, path) => {
    const p = typeof path === "function" ? path() : path;
    expect(checkPath(p, roots.project, roots)).toEqual({ allowed: true });
  });

  it.each([
    ["リポジトリの外", () => join(outside, "x.md")],
    [".. で外に出る", () => "../elsewhere/x.md"],
    ["ホームの設定", () => join(roots.home, ".claude", "CLAUDE.md")],
    ["ホームの別の場所", () => join(roots.home, "notes", "x.md")],
    ["シンボリックリンクで外に出る", () => "link-out/x.md"],
  ])("%s は止める", (_, path) => {
    expect(checkPath(path(), roots.project, roots)).toMatchObject({ allowed: false });
  });
});
