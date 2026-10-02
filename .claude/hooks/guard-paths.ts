// PreToolUse hook(Edit / Write / NotebookEdit): リポジトリの外のファイルを書き換えさせない。
//
// permissions の Write(path) ルールは参照されない(公式ドキュメント。パスで縛るのは Edit(path) だけ)。
// また、ユーザー設定(~/.claude/CLAUDE.md)の指示に従ってリポジトリの外を書き換えることがある。
// ここでは書き込み先の実体のパスを調べ、リポジトリの中と Claude Code 自身の作業場所だけを通す。
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type Verdict = { allowed: true } | { allowed: false; reason: string };

export type Roots = {
  project: string;
  /** セッションごとの一時ディレクトリ(hook の入力の scratchpad_dir) */
  scratchpad?: string;
  home: string;
};

/** シンボリックリンクをたどった実体のパス。まだないファイルは、存在する親ディレクトリから組み立てる */
export function realPath(p: string): string {
  let dir = p;
  const rest: string[] = [];
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    rest.unshift(dir.slice(parent.length + 1));
    dir = parent;
  }
  return join(existsSync(dir) ? realpathSync(dir) : dir, ...rest);
}

const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

export function checkPath(filePath: string, cwd: string, roots: Roots): Verdict {
  const target = realPath(resolve(cwd, filePath));
  const allowedRoots = [
    roots.project,
    roots.scratchpad,
    // Claude Code 自身が書く場所(プランファイルと、プロジェクトごとのメモリ)
    join(roots.home, ".claude", "plans"),
  ].filter((r): r is string => r !== undefined && r !== "");
  if (allowedRoots.some((r) => inside(target, realPath(r)))) return { allowed: true };
  const memory = relative(realPath(join(roots.home, ".claude", "projects")), target).split("/");
  if (memory.length >= 3 && memory[0] !== ".." && memory[1] === "memory") return { allowed: true };
  return {
    allowed: false,
    reason: `リポジトリの外のファイル(${target})は書き換えません。必要なら、何をどう変えるかを人に伝えてください。`,
  };
}

if (import.meta.main) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8")) as {
      tool_input?: { file_path?: string; notebook_path?: string };
      cwd?: string;
      scratchpad_dir?: string;
    };
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (filePath !== undefined) {
      const verdict = checkPath(filePath, input.cwd ?? process.cwd(), {
        project: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
        scratchpad: input.scratchpad_dir,
        home: homedir(),
      });
      if (!verdict.allowed) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `[guard-paths] ${verdict.reason}`,
            },
          }),
        );
      }
    }
  } catch (e) {
    process.stderr.write(`[guard-paths] hook の実行に失敗したため止めました: ${(e as Error).message}\n`);
    process.exit(2);
  }
}
