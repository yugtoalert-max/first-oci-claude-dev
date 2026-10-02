# first-oci-claude-dev

note 連載「OCI上のシステム開発をGitとClaude Codeを活用して行うためのデファクトにトライ」のサンプルリポジトリです。

Claude Code に書かせ、Git で履歴とレビューを残し、Terraform で OCI(Functions + API Gateway + NoSQL)に作って消す流れを、小さなメモ帳 API で最後まで試します。

- 各回の終わりの状態に Git タグ(`ep01-done` など)を付けます
- 手順は macOS を前提にしています
- クラウドへの作成・削除(`terraform apply` / `destroy`)とイメージの push は人が実行し、Claude Code には実行させません

## テスト

```sh
npm install
npm test            # Docker 不要のテスト
npm run typecheck   # 型検査(TypeScript 7)
npm run lint        # ESLint(typescript-eslint)
```

typescript-eslint は TypeScript 7 の API にまだ対応していないので、`typescript` には TypeScript 6 の互換パッケージ(`@typescript/typescript6`)を入れ、`tsc` は `@typescript/native`(TypeScript 7)を使います([TypeScript 7.0 の発表](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/))。

NoSQL リポジトリの契約テストは、ローカルの Docker で動かす Oracle NoSQL Database CE(KVLite)に対して実行します。

```sh
npm run kvlite:up       # KVLite のコンテナ(memo-kvlite、ポート 8080)を起動
npm run test:contract   # 契約テスト(起動直後は KVLite の準備ができるまで最大 2 分待ちます)
npm run kvlite:down     # コンテナを停止して削除
```

- イメージは `ghcr.io/oracle/nosql:latest-ce` です。Apple Silicon の Mac では Colima で動作を確認しています
- ポート 8080 が使えないときは、`kvlite:up` のポートを変えて起動し、`KVLITE_ENDPOINT=http://localhost:<ポート> npm run test:contract` で接続先を渡します
- テストは KVLite に `memos_contract_test` テーブルを作り、テストごとに中身を消します。コンテナを削除すればテーブルも消えます

## フロントエンド

手元の開発サーバーでの動かし方、手動確認のチェックリスト、配置スクリプト(`npm run deploy:web` / `npm run clean:web`)は [apps/web/README.md](apps/web/README.md) にあります。

## ライセンス

[MIT](LICENSE)
