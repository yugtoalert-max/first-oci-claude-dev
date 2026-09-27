# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

note 連載のサンプルリポジトリ。読者が追える小さな変更単位で進める。

## 守るべきルール

- **`terraform apply` / `terraform destroy` とコンテナイメージの push は人が実行する。Claude Code は実行しない。** `terraform plan` の結果や実行すべきコマンドの提示までに留める
- **このリポジトリは public。** OCID・Object Storage の namespace・メールアドレス・API Gateway の URL をファイルにもコミットメッセージにも書かない。必要な値は Git 管理外の `*.tfvars` / `.env` に置き、サンプルはプレースホルダ入りの `*.tfvars.example` / `.env.example` にする
- main へは直接 push しない。ブランチを切って PR にする
- コミットメッセージは Conventional Commits(`feat:` / `fix:` / `docs:` / `chore:` など)
- PR 本文は `.github/pull_request_template.md` の「何を変えたか / なぜ変えたか / どう確認したか」の形式で書く(`gh pr create --body` ではテンプレートが自動適用されないため)
- 作業完了の報告には、実行したコマンドとその結果を証拠として付ける
