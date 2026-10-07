# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

note 連載のサンプルリポジトリ。読者が追える小さな変更単位で進める。

## 守るべきルール

- **`terraform apply` / `terraform destroy`、コンテナイメージの push、Vault へのトークンの登録・更新、フロントエンドの配置と削除(`npm run deploy:web` / `npm run clean:web`)、配置の workflow の実行(`gh workflow run` を含む)と、アイデンティティドメインの設定は人が実行する。Claude Code は実行しない。** `terraform plan` の結果や実行すべきコマンドの提示までに留める
- **このリポジトリは public。秘密情報・認証情報・個人情報・環境固有の識別子を入れない。** 例えば OCID・Object Storage の namespace・メールアドレス・API Gateway の URL をファイルにもコミットメッセージにも書かない。必要な値は Git 管理外の `*.tfvars` / `.env` に置き、サンプルはプレースホルダ入りの `*.tfvars.example` / `.env.example` にする
- main へは直接 push しない。ブランチを切って PR にする
- PR のマージは、人から「マージして」と指示されたときだけ Claude Code が行ってよい(`gh pr merge <番号> --merge`)。マージの前に、変更内容とテストの結果を報告する。積み重ねた PR は下から順にマージする
- コミットメッセージは Conventional Commits(`feat:` / `fix:` / `docs:` / `chore:` など)
- PR 本文は `.github/pull_request_template.md` の「何を変えたか / なぜ変えたか / どう確認したか」の形式で書く(`gh pr create --body` ではテンプレートが自動適用されないため)
- 作業完了の報告には、実行したコマンドとその結果を証拠として付ける
- hook(`.claude/hooks/`)に止められたら、書き方を変えて回避しない。止められた理由を伝え、必要なら人に実行を頼む
