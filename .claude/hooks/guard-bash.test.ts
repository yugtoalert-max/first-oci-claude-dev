import { describe, expect, it } from "vitest";
import { check, isSecretPath } from "./guard-bash.ts";

const onFeature = { currentBranch: "feat/x" };
const onMain = { currentBranch: "main" };

describe("止めるコマンド", () => {
  it.each([
    // terraform: apply / destroy と、state を書き換える・中身を表示する操作
    "terraform apply",
    "terraform apply -auto-approve",
    "terraform -chdir=infra/envs/stg apply stg.tfplan",
    "terraform destroy",
    "terraform -chdir=infra/envs/stg destroy",
    "terraform import oci_core_vcn.this ocid1.vcn.oc1..xxxx",
    "terraform state list",
    "terraform show",
    "terraform output",
    "/opt/homebrew/bin/terraform apply",
    "tofu apply",
    // 第6回で起きたこと: fmt -diff は tfvars の中身を表示する
    "terraform fmt -check -diff infra",
    "terraform fmt -diff -recursive",
    // 書き方を変えても止める
    "cd infra/envs/stg && terraform apply",
    "npm test; terraform apply",
    "true || terraform destroy",
    "TF_LOG=debug terraform apply",
    "env TF_LOG=debug terraform apply",
    "timeout 600 terraform apply",
    "nohup terraform apply &",
    "bash -c 'terraform apply'",
    "sh -c \"cd infra/envs/stg && terraform destroy\"",
    "zsh -lc 'terraform apply'",
    "eval terraform apply",
    "echo $(terraform apply)",
    'echo "$(terraform destroy)"',
    "echo `terraform apply`",
    "(cd infra/envs/stg; terraform apply)",
    "{ terraform apply; }",
    "find . -name main.tf -execdir terraform apply \\;",
    "echo stg | xargs -I{} terraform -chdir=infra/envs/{} apply",
    "for d in stg; do terraform -chdir=infra/envs/$d apply; done",
    // oci: 読み取り(list / get)以外
    "oci nosql table delete --table-name-or-id memos --force",
    "oci fn function invoke --function-id x --body ''",
    "oci os object put --bucket-name b --file f",
    "oci vault secret update-base64 --secret-id x",
    "oci raw-request --http-method GET --target-uri https://example.com",
    "oci session authenticate",
    // コンテナイメージの push
    "docker push nrt.ocir.io/ns/memo-api:0.0.1",
    "docker image push x",
    "docker buildx build --push -t x .",
    "docker login nrt.ocir.io",
    "podman push x",
    "fn deploy --app memo",
    // main への push・強制 push
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin feat/x:refs/heads/main",
    "git push -f origin feat/x",
    "git push --force-with-lease origin feat/x",
    "git push origin +feat/x",
    "git push origin --delete feat/x",
    "git -C . push origin main",
    "git -c push.default=current push origin main",
    // フロントエンドの配置と削除
    "npm run deploy:web",
    "npm run clean:web",
    "node apps/web/scripts/deploy-web.ts",
    // 秘密情報が入るファイル
    "cat infra/envs/stg/terraform.tfvars",
    "head -5 infra/envs/stg/terraform.tfstate",
    "less infra/envs/stg/terraform.tfstate.backup",
    "grep compartment infra/envs/stg/*.tfvars",
    "cp infra/envs/stg/stg.tfplan /tmp/",
    "cat .env",
    "cat ~/.oci/config",
    "ls ~/.oci",
    "python3 -c 'print(1)' < infra/envs/stg/terraform.tfvars",
    "echo x > .env.local",
    // 解析できないものは止める
    "echo 'unterminated",
  ])("%s", (command) => {
    expect(check(command, onFeature)).toMatchObject({ allowed: false });
  });

  it.each(["git push", "git push origin", "git push origin HEAD", "git push -u origin HEAD"])(
    "main にいるときの %s",
    (command) => {
      expect(check(command, onMain)).toMatchObject({ allowed: false });
    },
  );
});

describe("通すコマンド", () => {
  it.each([
    "npm test",
    "npm run typecheck",
    "npm run build",
    "terraform fmt -check -recursive infra",
    "terraform -chdir=infra/envs/stg validate",
    "terraform -chdir=infra/envs/stg plan",
    "terraform -chdir=infra/envs/stg init",
    "terraform version",
    "oci --version",
    "oci nosql table list --compartment-id x",
    "oci nosql table get --table-name-or-id memos",
    "oci os object list --bucket-name b",
    "oci fn application list --compartment-id x",
    "docker build -t memo-api .",
    "docker images",
    "fn build",
    "git status",
    "git push -u origin feat/x",
    "git push origin feat/ep07-guardrail-hooks",
    "git push origin ep07-done",
    "gh pr create --title t --body b",
    "gh pr merge 25 --merge",
    "cat infra/envs/stg/terraform.tfvars.example",
    "cat .env.example",
    "ls infra/envs/stg",
    "echo terraform apply",
    "echo 'terraform apply は人が実行する'",
    "grep -rn 'terraform apply' README.md",
    "git commit -m 'docs: terraform apply と destroy は人が実行する'",
    "ls 2>&1 | head",
    "npm test > /dev/null 2>&1",
    // コミットメッセージのヒアドキュメントの本文はコマンドではない
    `git commit -m "$(cat <<'EOF'
feat: add guard hooks

terraform apply (and destroy) stay manual; don't run them.
EOF
)"`,
    `cat <<EOF > notes.txt
terraform destroy
EOF`,
  ])("%s", (command) => {
    expect(check(command, onFeature)).toEqual({ allowed: true });
  });
});

describe("isSecretPath", () => {
  it.each([
    ["terraform.tfvars", true],
    ["infra/envs/stg/stg.tfvars", true],
    ["x.tfvars.json", true],
    ["terraform.tfstate", true],
    ["terraform.tfstate.backup", true],
    ["stg.tfplan", true],
    [".env", true],
    [".env.local", true],
    ["key.pem", true],
    ["~/.oci/config", true],
    ["/Users/me/.oci", true],
    ["terraform.tfvars.example", false],
    [".env.example", false],
    ["main.tf", false],
    ["environment.ts", false],
  ])("%s → %s", (path, expected) => {
    expect(isSecretPath(path)).toBe(expected);
  });
});
