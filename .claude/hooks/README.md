# Claude Code の hooks

`CLAUDE.md` に書いたルールは Claude Code への助言で、守られないことがあります。
hooks は Claude Code が毎回実行するので、守らせたいルールをここに移しています。
登録は `.claude/settings.json` の `hooks` です。

| hook | タイミング | すること |
|---|---|---|
| `guard-bash.ts` | Bash を実行する前(PreToolUse) | 人が実行すると決めた操作と、秘密情報のファイルに触れるコマンドを止める |
| `guard-paths.ts` | Edit / Write / NotebookEdit の前(PreToolUse) | リポジトリの外のファイルの書き換えを止める |
| `verify-on-stop.ts` | 応答を終える前(Stop) | 型チェック・テスト(`infra/` に変更があれば `terraform fmt -check` と `validate`)を実行し、失敗したら1回だけ差し戻す |

## guard-bash が止めるもの

- `terraform apply` / `destroy` / `import` / `state` / `show` / `output` など、state を書き換える・中身を表示する操作
- `terraform fmt -diff`(`*.tfvars` の中身も差分として表示するため)
- `oci` のうち、読み取り(`list` / `get` など)以外の操作と `oci raw-request` / `session` / `setup`
- コンテナイメージの push(`docker push`、`build --push`、`fn deploy` など)とレジストリへのログイン
- main への push、強制 push、ブランチの削除
- `npm run deploy:web` / `npm run clean:web`
- `*.tfvars`・tfstate・plan ファイル・`.env`・`*.pem`・`~/.oci` を引数やリダイレクト先に含むコマンド

コマンドは区切り(`&&` `;` `|` など)ごとに分け、`env` や `timeout` などのラッパー、`bash -c '...'`、`$(...)`、`find -exec`、`xargs` の中まで調べます。

## 限界

- **hooks はセキュリティ境界ではありません。** 調べるのは Claude Code が書いたコマンドの文字列だけです。スクリプトや `npm run` の中から呼ばれる操作、ファイル名を引数に取らずに読む操作(`grep -r` など)は見えません。これは次の sandbox で補います
- 解析できないコマンドは止めます。正しいコマンドが止められたら、書き方を単純にしてください

## sandbox

`.claude/settings.json` の `sandbox` で、Claude Code が実行する Bash コマンドを OS(macOS では Seatbelt)が制限します。hooks と違って、コマンドから起動されたプロセスにも効きます。

- **読み取り**: `permissions.deny` の `Read(...)` が、そのまま sandbox の読み取り禁止にもなる。tfvars・tfstate・plan ファイル・`.env`・`~/.oci` は、`grep -r` やスクリプトからも読めない
- **書き込み**: リポジトリと一時ディレクトリだけ
- **通信**: `allowedDomains` に書いたドメイン(GitHub・npm・Terraform Registry)だけ。それ以外は止まる
- **Docker**: Colima のソケットだけ接続できる

sandbox の外で実行するコマンド(`excludedCommands`):

| コマンド | 理由 |
|---|---|
| `terraform -chdir=infra/envs/* plan` / `init` | plan は tfvars と `~/.oci` の鍵を読む。また、Go 製の CLI は macOS の sandbox の中で TLS 証明書を検証できない(公式ドキュメント) |
| `terraform fmt` | `-recursive` でディレクトリを渡すと tfvars も読む。`-diff` は guard-bash が止める |
| `gh pr` | Go 製の CLI で、TLS 証明書を検証できない |

外で実行するコマンドも、hooks と `permissions` の確認は受けます。**plan を Claude Code が実行している間は、Claude Code から鍵が読める状態です。** 本当の境界は、OCI 側で Claude Code が使う鍵の権限を絞ることです。

`excludedCommands` は、パイプやリダイレクトでつないだコマンドの全部が一致したときだけ効きます。`terraform -chdir=infra/envs/stg plan | tail` は sandbox の中で実行され、tfvars を読めずに失敗します。

## ガードレール自身の保護

`.claude/` の下の編集は `permissions.ask` で毎回人に確認します。auto モードでは `.claude/` への書き込みが分類器の判断で通ることがあるため(公式ドキュメント)、Claude Code が自分で hooks や設定を緩められないようにしています。

## テスト

```sh
npx vitest run .claude/hooks   # 止める/通すコマンドの表
npx tsc -p .claude/hooks       # npm run typecheck にも含まれる
```
