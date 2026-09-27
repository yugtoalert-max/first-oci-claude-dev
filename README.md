# first-oci-claude-dev

note 連載「OCI上のシステム開発をGitとClaude Codeを活用して行うためのデファクトにトライ」のサンプルリポジトリです。

Claude Code に書かせ、Git で履歴とレビューを残し、Terraform で OCI(Functions + API Gateway + NoSQL)に作って消す流れを、小さなメモ帳 API で最後まで試します。

- 各回の終わりの状態に Git タグ(`ep01-done` など)を付けます
- 手順は macOS を前提にしています
- クラウドへの作成・削除(`terraform apply` / `destroy`)とイメージの push は人が実行し、Claude Code には実行させません

## ライセンス

[MIT](LICENSE)
