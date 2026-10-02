// Stop hook: Claude Code が応答を終える前に、型チェック・テスト・Terraform の検証を実行する。
// 失敗したら exit 2 で止め、出力の末尾を Claude Code に返して直させる。
//
// - main から変更がないときは何もしない(質問に答えただけのときに毎回走らせない)
// - Terraform の検証は infra/ に変更があるときだけ実行する。terraform fmt は -diff を付けず、
//   対象を *.tf に絞る(*.tfvars は人のファイルで、-diff はその中身も表示する)
// - 1回止めて直させた後(stop_hook_active が true)は、もう止めない。直せないまま
//   止め続けるのを避けるため。その場合も結果は表示する
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Step = { name: string; cmd: string; args: string[]; cwd?: string };

const project = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const git = (...args: string[]) =>
  spawnSync("git", ["-C", project, ...args], { encoding: "utf8" }).stdout?.trim() ?? "";

/** main から変わったファイル(コミット済み・未コミット・未追跡を合わせる) */
export function changedFiles(): string[] {
  const base = git("merge-base", "HEAD", "origin/main") || "HEAD";
  const committed = git("diff", "--name-only", `${base}...HEAD`);
  const working = git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .map((l) => l.slice(3));
  return [...new Set([...committed.split("\n"), ...working].filter((f) => f !== ""))];
}

export function stepsFor(files: string[]): Step[] {
  const steps: Step[] = [
    { name: "typecheck", cmd: "npm", args: ["run", "typecheck", "--silent"] },
    { name: "test", cmd: "npm", args: ["test", "--silent"] },
  ];
  if (files.some((f) => f.startsWith("infra/"))) {
    // 対象は Git 管理下と新規の *.tf だけ。-recursive にすると Git 管理外の *.tfvars(人のファイル)まで調べる
    const tf = git("ls-files", "--cached", "--others", "--exclude-standard", "infra/*.tf", "infra/**/*.tf")
      .split("\n")
      .filter((f) => f !== "");
    if (tf.length > 0) steps.push({ name: "terraform fmt", cmd: "terraform", args: ["fmt", "-check", ...tf] });
    for (const env of ["stg"]) {
      const dir = join("infra", "envs", env);
      if (existsSync(join(project, dir, ".terraform"))) {
        steps.push({ name: `terraform validate (${env})`, cmd: "terraform", args: [`-chdir=${dir}`, "validate", "-no-color"] });
      }
    }
  }
  return steps;
}

if (import.meta.main) {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const files = changedFiles();
  if (files.length === 0) process.exit(0);

  const failures: string[] = [];
  for (const step of stepsFor(files)) {
    const r = spawnSync(step.cmd, step.args, { cwd: project, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    if (r.status !== 0) {
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`.trim().split("\n").slice(-30).join("\n");
      failures.push(`### ${step.name} が失敗しました(exit ${r.status})\n${out}`);
    }
  }
  if (failures.length === 0) process.exit(0);

  const report = `[verify-on-stop] 終わる前の検証で失敗がありました。\n\n${failures.join("\n\n")}`;
  if (input.stop_hook_active === true) {
    // 2回目は止めずに、人に結果を見せる
    process.stdout.write(JSON.stringify({ systemMessage: `${report}\n\n(直せないまま終了しました。人が確認してください)` }));
    process.exit(0);
  }
  process.stderr.write(`${report}\n\n直してから終えてください。直せない場合は、その理由を報告してください。\n`);
  process.exit(2);
}
