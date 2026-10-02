// PreToolUse hook(Bash): 人が実行すると決めた操作と、秘密情報を読む操作を止める。
//
// permissions の Bash ルールはコマンドの文字列と照合するだけで、
// `bash -c '...'` や `git -C . push` のような別の書き方は通ってしまう(公式ドキュメント)。
// ここではコマンドを分解して、ラッパーや sh -c / $(...) の中まで調べる。
// それでもスクリプトの中から呼ばれる操作までは見えないので、セキュリティ境界ではない。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export type Verdict = { allowed: true } | { allowed: false; reason: string };

export type Context = {
  /** git push の宛先を決めるために使う、作業ディレクトリの現在のブランチ */
  currentBranch?: string;
};

type Segment = { words: string[]; redirects: string[] };
type Parsed = { segments: Segment[]; nested: string[] };

/** 配列の k 番目。範囲外は空文字列 */
const at = (a: readonly string[], k: number): string => a[k] ?? "";

const ALLOW: Verdict = { allowed: true };
const deny = (reason: string): Verdict => ({ allowed: false, reason });

// ---------------------------------------------------------------------------
// 字句解析: 区切り(&& || ; | & 改行)ごとの単語列と、$(...) などの中身を取り出す
// ---------------------------------------------------------------------------

export function parse(command: string): Parsed {
  const segments: Segment[] = [];
  const nested: string[] = [];
  let words: string[] = [];
  let redirects: string[] = [];
  let word: string | null = null;
  let redirectNext = false;
  const heredocs: { delim: string; strip: boolean }[] = [];
  let i = 0;

  const endWord = () => {
    if (word === null) return;
    if (redirectNext) {
      redirects.push(word);
      redirectNext = false;
    } else if (heredocPending) {
      heredocs.push({ delim: word, strip: heredocStrip });
      heredocPending = false;
    } else {
      words.push(word);
    }
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0 || redirects.length > 0) segments.push({ words, redirects });
    words = [];
    redirects = [];
  };
  let heredocPending = false;
  let heredocStrip = false;

  const readBalanced = (start: number) => readBalancedIn(command, start);
  const skipDouble = (start: number) => skipDoubleIn(command, start);
  const readBacktick = (start: number): [string, number] => {
    let j = start;
    while (j < command.length) {
      if (command[j] === "\\") {
        j += 2;
        continue;
      }
      if (command[j] === "`") return [command.slice(start, j), j + 1];
      j++;
    }
    throw new Error("閉じていない ` があります");
  };
  const append = (s: string) => {
    word = (word ?? "") + s;
  };

  while (i < command.length) {
    const c = command[i];
    const next = command[i + 1];

    if (c === "\n") {
      endSegment();
      i++;
      // ヒアドキュメントの本文はコマンドではないので読み飛ばす
      for (const h of heredocs.splice(0)) {
        while (i <= command.length) {
          const eol = command.indexOf("\n", i);
          const line = command.slice(i, eol < 0 ? command.length : eol);
          i = eol < 0 ? command.length : eol + 1;
          if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
          if (eol < 0) break;
        }
      }
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      i++;
      continue;
    }
    if (c === "\\") {
      if (next === "\n") {
        i += 2;
        continue;
      }
      append(next ?? "");
      i += 2;
      continue;
    }
    if (c === "#" && word === null) {
      const eol = command.indexOf("\n", i);
      i = eol < 0 ? command.length : eol;
      continue;
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) throw new Error("閉じていない ' があります");
      append(command.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const end = skipDouble(i + 1);
      const inner = command.slice(i + 1, end - 1);
      // "..." の中の $(...) と `...` は実行される
      collectSubstitutions(inner, nested);
      append(inner.replace(/\\(["\\$`])/g, "$1"));
      i = end;
      continue;
    }
    if (c === "$" && next === "(") {
      const [inner, end] = readBalanced(i + 2);
      nested.push(inner.startsWith("(") ? "" : inner); // $((...)) は算術式
      append("$(...)");
      i = end;
      continue;
    }
    if (c === "`") {
      const [inner, end] = readBacktick(i + 1);
      nested.push(inner);
      append("$(...)");
      i = end;
      continue;
    }
    if ((c === "<" || c === ">") && next === "(") {
      const [inner, end] = readBalanced(i + 2);
      nested.push(inner);
      endWord();
      i = end;
      continue;
    }
    if (c === "<" && next === "<") {
      endWord();
      if (command[i + 2] === "<") {
        // <<< はヒアストリング。続く単語は入力の文字列
        redirectNext = true;
        i += 3;
        continue;
      }
      heredocPending = true;
      heredocStrip = command[i + 2] === "-";
      i += heredocStrip ? 3 : 2;
      continue;
    }
    if (c === "<" || c === ">" || (c === "&" && next === ">")) {
      // 2>&1 のような fd の付け替えは対象のファイルがない
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      let j = i + 1;
      if (c === "&") j++;
      while (command[j] === ">" || command[j] === "|") j++;
      if (command[j] === "&") {
        j++;
        while (/[\d-]/.test(command[j] ?? "")) j++;
        i = j;
        continue;
      }
      redirectNext = true;
      i = j;
      continue;
    }
    if (c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      endSegment();
      i += (c === "&" && next === "&") || (c === "|" && (next === "|" || next === "&")) || (c === ";" && next === ";") ? 2 : 1;
      continue;
    }
    if ((c === "{" || c === "}") && word === null && /[\s;]/.test(next ?? " ")) {
      endSegment();
      i++;
      continue;
    }
    append(c ?? "");
    i++;
  }
  endSegment();
  return { segments, nested: nested.filter((s) => s.trim() !== "") };
}

// 対応する閉じ括弧までを返す。引用符とヒアドキュメントの中の括弧は数えない
function readBalancedIn(text: string, start: number): [string, number] {
  let depth = 1;
  let j = start;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", j + 1);
      if (end < 0) throw new Error("閉じていない ' があります");
      j = end + 1;
      continue;
    }
    if (c === '"') {
      j = skipDoubleIn(text, j + 1);
      continue;
    }
    if (c === "<" && text[j + 1] === "<" && text[j + 2] !== "<") {
      j = skipHeredocIn(text, j + 2);
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) return [text.slice(start, j), j + 1];
    }
    j++;
  }
  throw new Error("閉じていない ( があります");
}

function skipDoubleIn(text: string, start: number): number {
  let j = start;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === '"') return j + 1;
    if (c === "$" && text[j + 1] === "(") {
      j = readBalancedIn(text, j + 2)[1];
      continue;
    }
    j++;
  }
  throw new Error('閉じていない " があります');
}

/** << の直後から、ヒアドキュメントの終わりの行の次までを読み飛ばす */
function skipHeredocIn(text: string, start: number): number {
  const m = /^(-?)[ \t]*(['"]?)([A-Za-z0-9_]+)\2/.exec(text.slice(start));
  if (m === null) return start;
  const strip = m[1] === "-";
  const delim = m[3];
  let j = text.indexOf("\n", start + m[0].length);
  if (j < 0) return text.length;
  j++;
  while (j < text.length) {
    const eol = text.indexOf("\n", j);
    const line = text.slice(j, eol < 0 ? text.length : eol);
    j = eol < 0 ? text.length : eol + 1;
    if ((strip ? line.replace(/^\t+/, "") : line) === delim) return j;
  }
  return text.length;
}

function collectSubstitutions(text: string, out: string[]) {
  // ダブルクォートの中身から $(...) と `...` を取り出す(入れ子は parse の再帰で調べる)
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "$" && text[i + 1] === "(") {
      const [inner, end] = readBalancedIn(text, i + 2);
      out.push(inner);
      i = end - 1;
    } else if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end < 0) break;
      out.push(text.slice(i + 1, end));
      i = end;
    }
  }
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
// if / while / for の本体の先頭に付く予約語。外すと後ろがコマンドになる
const KEYWORDS = new Set(["if", "then", "else", "elif", "while", "until", "do", "!"]);
const WRAPPERS = new Set(["command", "builtin", "exec", "nohup", "time", "noglob", "nocorrect", "sudo", "caffeinate"]);

export function check(command: string, ctx: Context = {}, depth = 0): Verdict {
  if (depth > 8) return deny("コマンドの入れ子が深すぎて調べられません。");
  let parsed: Parsed;
  try {
    parsed = parse(command);
  } catch (e) {
    return deny(`コマンドを解析できませんでした(${(e as Error).message})。書き方を単純にしてください。`);
  }
  for (const inner of parsed.nested) {
    const v = check(inner, ctx, depth + 1);
    if (!v.allowed) return v;
  }
  for (const seg of parsed.segments) {
    const v = checkSegment(seg, ctx, depth);
    if (!v.allowed) return v;
  }
  return ALLOW;
}

function checkSegment(seg: Segment, ctx: Context, depth: number): Verdict {
  const secret = [...seg.words, ...seg.redirects].find(isSecretPath);
  if (secret !== undefined) {
    return deny(
      `秘密情報が入るファイル(${secret})に触れるコマンドは実行しません。tfvars・tfstate・plan ファイル・.env・~/.oci は人だけが扱います。`,
    );
  }
  const words = unwrap(seg.words);
  if (words.length === 0) return ALLOW;
  const prog = basename(at(words, 0));
  const args = words.slice(1);

  if (SHELLS.has(prog)) {
    const idx = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (idx >= 0 && idx + 1 < args.length) return check(at(args, idx + 1), ctx, depth + 1);
    return ALLOW;
  }
  if (prog === "eval") return check(args.join(" "), ctx, depth + 1);
  if (prog === "xargs") return checkWords(skipXargsOptions(args), ctx, depth);
  if (prog === "find") {
    for (let k = 0; k < args.length; k++) {
      if (/^-(exec|execdir|ok|okdir)$/.test(at(args, k))) {
        const end = args.findIndex((a, n) => n > k && (a === ";" || a === "+"));
        const v = checkWords(args.slice(k + 1, end < 0 ? undefined : end), ctx, depth);
        if (!v.allowed) return v;
      }
    }
    return ALLOW;
  }
  return checkProgram(prog, args, ctx);
}

function checkWords(words: string[], ctx: Context, depth: number): Verdict {
  return checkSegment({ words, redirects: [] }, ctx, depth + 1);
}

/** 先頭の環境変数の代入と、引数のコマンドをそのまま実行するラッパーを外す */
function unwrap(words: string[]): string[] {
  let w = words;
  for (;;) {
    while (w.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(at(w, 0))) w = w.slice(1);
    if (w.length === 0) return w;
    if (KEYWORDS.has(at(w, 0))) {
      w = w.slice(1);
      continue;
    }
    const prog = basename(at(w, 0));
    if (WRAPPERS.has(prog)) {
      w = w.slice(1);
      while (w.length > 0 && at(w, 0).startsWith("-")) w = w.slice(1);
      continue;
    }
    if (prog === "env") {
      w = w.slice(1);
      while (w.length > 0 && (at(w, 0).startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(at(w, 0)))) {
        w = w.slice(/^-(u|C|S)$/.test(at(w, 0)) ? 2 : 1);
      }
      continue;
    }
    if (prog === "nice" || prog === "stdbuf" || prog === "ionice") {
      w = w.slice(1);
      while (w.length > 0 && at(w, 0).startsWith("-")) w = w.slice(/^-(n|c)$/.test(at(w, 0)) ? 2 : 1);
      continue;
    }
    if (prog === "timeout") {
      w = w.slice(1);
      while (w.length > 0 && at(w, 0).startsWith("-")) w = w.slice(/^-(s|k)$/.test(at(w, 0)) ? 2 : 1);
      w = w.slice(1); // 時間
      continue;
    }
    return w;
  }
}

function skipXargsOptions(args: string[]): string[] {
  let k = 0;
  while (k < args.length && at(args, k).startsWith("-")) {
    k += /^-(n|I|L|P|s|d|E|a)$/.test(at(args, k)) ? 2 : 1;
  }
  return args.slice(k);
}

function checkProgram(prog: string, args: string[], ctx: Context): Verdict {
  switch (prog) {
    case "terraform":
    case "tofu":
      return checkTerraform(args);
    case "oci":
      return checkOci(args);
    case "docker":
    case "podman":
    case "nerdctl":
      return checkDocker(args);
    case "fn":
      return checkFn(args);
    case "git":
      return checkGit(args, ctx);
    case "npm":
    case "pnpm":
    case "yarn":
      return checkNpm(args);
    case "node":
    case "tsx":
    case "ts-node":
      if (args.some((a) => /(^|\/)(deploy-web|clean-web)\.[cm]?[jt]s$/.test(a))) {
        return deny("フロントエンドの配置と削除は人が実行します(npm run deploy:web / clean:web)。");
      }
      return ALLOW;
    default:
      return ALLOW;
  }
}

/** 秘密情報が入るファイルか(*.example のようなサンプルは除く) */
export function isSecretPath(word: string): boolean {
  const w = word.replace(/^['"]|['"]$/g, "");
  if (/\.example$/.test(w)) return false;
  const name = w.split("/").pop() ?? "";
  return (
    /\.tfvars(\.json)?$/.test(name) ||
    /\.tfstate(\..*)?$/.test(name) ||
    /\.tfplan$/.test(name) ||
    /^\.env(\..+)?$/.test(name) ||
    /\.pem$/.test(name) ||
    // docker run -v ~/.oci:/x や --mount src=~/.oci,dst=/x の書き方も含める
    /(^|[/:=])\.oci([/:,]|$)/.test(w) ||
    /^~\/\.oci/.test(w)
  );
}

const TERRAFORM_DENY: Record<string, string> = {
  apply: "terraform apply は人が実行します。plan の結果と、実行するコマンドを示すところまでにしてください。",
  destroy: "terraform destroy は人が実行します。",
  import: "terraform import は state を書き換えるので人が実行します。",
  taint: "terraform taint は state を書き換えるので人が実行します。",
  untaint: "terraform untaint は state を書き換えるので人が実行します。",
  "force-unlock": "terraform force-unlock は人が実行します。",
  refresh: "terraform refresh は state を書き換えるので人が実行します。",
  state: "terraform state は OCID などを含む state を読み書きするので人が実行します。",
  show: "terraform show は state や plan ファイルの中身(OCID や秘密情報)を表示するので人が実行します。",
  output: "terraform output は値をそのまま表示するので人が実行します。",
  console: "terraform console は state の値を読めるので人が実行します。",
};

function checkTerraform(args: string[]): Verdict {
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub === undefined) return ALLOW;
  const reason = TERRAFORM_DENY[sub];
  if (reason !== undefined) return deny(reason);
  if (sub === "fmt" && args.some((a) => a === "-diff" || a === "--diff")) {
    return deny(
      "terraform fmt -diff は *.tfvars の中身も差分として表示します。-check だけ(ファイル名の一覧)にするか、対象を *.tf のディレクトリに絞ってください。",
    );
  }
  return ALLOW;
}

const OCI_DENY = new Set(["setup", "session", "raw-request"]);

function checkOci(args: string[]): Verdict {
  const path: string[] = [];
  for (const a of args) {
    if (a.startsWith("-")) break;
    path.push(a);
  }
  if (path.length === 0) return ALLOW; // oci --version など
  if (OCI_DENY.has(at(path, 0))) return deny(`oci ${at(path, 0)} は人が実行します。`);
  const action = at(path, path.length - 1);
  if (/^(list|get|search|head)(-|$)/.test(action)) return ALLOW;
  return deny(
    `oci ${path.join(" ")} はクラウドのリソースを変更する可能性があるので人が実行します。読み取り(list / get)だけ実行できます。変更は Terraform で行います。`,
  );
}

function checkDocker(args: string[]): Verdict {
  const rest = args.filter((a) => !a.startsWith("-"));
  if (rest.includes("push")) return deny("コンテナイメージの push は人が実行します。");
  if (rest[0] === "login") return deny("レジストリへのログインは人が実行します(認証トークンを扱うため)。");
  if ((rest[0] === "build" || rest[0] === "buildx") && args.some((a) => a === "--push" || /^--output=.*push=true/.test(a))) {
    return deny("build --push はイメージを push するので人が実行します。");
  }
  return ALLOW;
}

function checkFn(args: string[]): Verdict {
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub === undefined || ["list", "ls", "inspect", "version", "build", "help"].includes(sub)) return ALLOW;
  return deny(`fn ${sub} は OCI 上の関数やレジストリを変更するので人が実行します。`);
}

const GIT_OPTS_WITH_ARG = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const PROTECTED_BRANCHES = new Set(["main", "master"]);

function checkGit(args: string[], ctx: Context): Verdict {
  let k = 0;
  while (k < args.length && at(args, k).startsWith("-")) k += GIT_OPTS_WITH_ARG.has(at(args, k)) ? 2 : 1;
  if (args[k] !== "push") return ALLOW;
  const opts = args.slice(k + 1);
  if (opts.some((a) => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror|--delete|-d|--all|--prune)$/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a))) {
    return deny("強制 push・ブランチの削除・一括 push は人が実行します。");
  }
  const positional = opts.filter((a) => !a.startsWith("-"));
  const refspecs = positional.slice(1);
  if (refspecs.some((r) => r.startsWith("+"))) return deny("強制 push(+refspec)は人が実行します。");
  const targets =
    refspecs.length === 0 || refspecs.every((r) => r === "HEAD")
      ? [ctx.currentBranch ?? ""]
      : refspecs.map((r) => r.split(":").pop()!.replace(/^refs\/heads\//, ""));
  const hit = targets.find((t) => PROTECTED_BRANCHES.has(t) || t === "");
  if (hit !== undefined) {
    return deny(
      hit === ""
        ? "push 先のブランチを判定できませんでした。git push -u origin <ブランチ名> のように明示してください。"
        : `${hit} へは直接 push しません。ブランチを切って PR にしてください。`,
    );
  }
  return ALLOW;
}

function checkNpm(args: string[]): Verdict {
  const k = args.findIndex((a) => a === "run" || a === "run-script");
  const script = k >= 0 ? args[k + 1] : args.find((a) => !a.startsWith("-"));
  if (script === "deploy:web" || script === "clean:web") {
    return deny("フロントエンドの配置と削除は人が実行します(npm run deploy:web / clean:web)。");
  }
  return ALLOW;
}

// ---------------------------------------------------------------------------
// hook としての入口
// ---------------------------------------------------------------------------

function currentBranch(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const command: string = input.tool_input?.command ?? "";
    const verdict = check(command, { currentBranch: currentBranch(input.cwd ?? process.cwd()) });
    if (!verdict.allowed) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `[guard-bash] ${verdict.reason}`,
          },
        }),
      );
    }
    // 許可のときは何も出力せず、通常の権限の判定に任せる
  } catch (e) {
    // hook 自体が壊れたときは止める側に倒す(exit 2 はツールの呼び出しを止める)
    process.stderr.write(`[guard-bash] hook の実行に失敗したため止めました: ${(e as Error).message}\n`);
    process.exit(2);
  }
}
