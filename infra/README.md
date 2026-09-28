# infra

stg 環境を Terraform で作ります。第4回で作ったコンパートメント・VCN・NoSQL テーブルに、第6回で Functions・API Gateway・Vault・画面用のバケット・コンテナリポジトリ・IAM・ログを足しました。

```
infra/
  modules/network/      VCN・サブネット(public / private)・Internet Gateway・Service Gateway
  modules/nosql/        メモ保存用テーブル(プロビジョンド最小構成: 読み取り 1・書き込み 1・容量 1GB)
  modules/web_bucket/   画面用のバケット(非公開)と、読み取り専用・一覧不可の PAR
  modules/vault/        認証トークン用の Vault(共有型)と鍵。シークレットは作らない
  modules/functions/    コンテナリポジトリ(OCIR)×2・Functions のアプリケーション・Function×2・呼び出しログ
  modules/iam/          Functions 用の動的グループとポリシー
  modules/api_gateway/  API Gateway・デプロイメント・アクセスログと実行ログ
  envs/stg/             stg 環境のルートモジュール
```

## 前提

- Terraform 1.5 以上
- OCI CLI の設定(`~/.oci/config`)が済んでいること。provider はこのプロファイルで認証します
- ホームリージョンで実行すること(コンパートメントと動的グループはホームリージョンでしか作れません)
- Docker(Apple Silicon の Mac なら Colima など)。Function のイメージを `linux/arm64` でビルドします

## 誰が実行するか

`terraform apply` / `terraform destroy`、イメージの push、Vault へのトークンの登録・更新、`npm run deploy:web` / `npm run clean:web` は**人が実行します**。Claude Code は `terraform plan` の結果や、実行すべきコマンドを示すところまでです。

## 手順の全体

Function のイメージはまだ OCIR にないので、apply を 2 回に分けます。

| # | 作業 | 作るもの・やること |
|---|---|---|
| 1 | 1 回目の apply | バケット・PAR・Vault・鍵・リポジトリ・Functions のアプリケーション・IAM・ロググループと呼び出しログ・API Gateway(デプロイメントなし) |
| 2 | シークレットの作成 | 認証トークンを作り、Vault にシークレットとして登録する |
| 3 | イメージの push | `npm run build:functions` で作ったイメージにタグを付けて OCIR に push する |
| 4 | 2 回目の apply | tfvars にイメージとシークレットの OCID を入れる → Function・API Gateway のデプロイメント・アクセスログと実行ログ・シークレットの読み取り権限 |
| 5 | 画面の配置 | `npm run deploy:web` |
| 6 | 動作確認 | curl とブラウザ |

`memo_api_image`・`authorizer_image`・`auth_token_secret_id` の 3 つがそろうまで、Function とデプロイメントは作りません。一部だけ入れると plan が止まります。

コマンドは、特に書いていなければリポジトリのルートで実行します。Terraform は `-chdir` で `infra/envs/stg` を指定します。

### 0. 変数ファイルを作る

```sh
cp infra/envs/stg/terraform.tfvars.example infra/envs/stg/terraform.tfvars
```

`terraform.tfvars`(Git 管理外)に、次の値を入れます。

- `parent_compartment_ocid`: 親コンパートメントの OCID(第4回と同じ)
- `tenancy_ocid`: テナンシの OCID(`~/.oci/config` の `tenancy`)
- `web_par_expires_at`: PAR の有効期限(例: `2027-03-31T00:00:00Z`)。過ぎると画面が表示されなくなります([PAR の更新](#par-の有効期限を延ばす))
- `cors_allowed_origins`: stg は手元の開発サーバー(`["http://localhost:5173"]`)。prod は `[]`

### 1. 1 回目の apply

```sh
terraform -chdir=infra/envs/stg init
terraform -chdir=infra/envs/stg fmt -check -recursive ../..
terraform -chdir=infra/envs/stg validate
terraform -chdir=infra/envs/stg plan -out=stg.tfplan   # Claude Code でも可
terraform -chdir=infra/envs/stg apply stg.tfplan        # 人のみ
```

- plan では、既存のコンパートメント・VCN・NoSQL テーブルに変更がないこと(`to change` と `to destroy` が 0)を確かめてから apply します
- PAR の URL は sensitive にしてあるので、plan と output には `(sensitive value)` と出ます

### 2. シークレットを作る(認証トークンの登録)

認証トークンは 32 バイトの乱数を base64url にしたもの(43 文字)です(SPEC 7 章)。値を画面とシェルの履歴に出さないよう、権限を絞った一時ファイルに書き、OCI CLI にはファイルで渡します。

```sh
COMPARTMENT_ID="$(terraform -chdir=infra/envs/stg output -raw compartment_id)"
VAULT_ID="$(terraform -chdir=infra/envs/stg output -raw vault_id)"
KEY_ID="$(terraform -chdir=infra/envs/stg output -raw vault_key_id)"

WORK="$(mktemp -d)"             # 自分だけが読めるディレクトリ(700)
( umask 077
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > "$WORK/token"
  base64 < "$WORK/token" | tr -d '\n' > "$WORK/token.b64"   # Vault には base64 にして渡す
)
wc -c < "$WORK/token"           # 43 になること(値は表示しない)

oci vault secret create-base64 \
  --compartment-id "$COMPARTMENT_ID" \
  --vault-id "$VAULT_ID" \
  --key-id "$KEY_ID" \
  --secret-name first-oci-claude-dev-stg-auth-token \
  --secret-content-content "file://$WORK/token.b64" \
  --wait-for-state ACTIVE \
  --query 'data.id' --raw-output
# → 表示されたシークレットの OCID を控える(手順 4 で使う)

pbcopy < "$WORK/token"          # トークンをクリップボードに入れ、パスワードマネージャーに保存する
rm -rf "$WORK"
```

- `~/.oci/config` の `DEFAULT` 以外のプロファイルを使うときは、`oci` に `--profile <名前>` を付けます
- stg と prod では別のトークンを使います
- トークンの取り替えは `oci vault secret update-base64 --secret-id <OCID> --secret-content-content file://...` で同じように行います。authorizer と API Gateway のキャッシュがあるので、古いトークンが通らなくなるまで最大で約 10 分かかります

### 3. イメージを OCIR に push する

OCIR へのログインには、パスワードの代わりに**認証トークン**(上の認証トークンとは別物)を使います。

1. コンソールの右上のプロファイル → 自分のユーザーの詳細 → 「トークンとキー」(Tokens and keys)の「認証トークン」で、トークンを作ります。表示は 1 回だけなので、パスワードマネージャーに保存します
2. ログインします。ユーザー名は `<namespace>/<ユーザー名>`(フェデレーションしているユーザーは `<namespace>/<ドメイン名>/<ユーザー名>`。コンソールのプロファイルのメニューに出る形)。パスワードはプロンプトに貼り付けます(引数や `echo` で渡すと、シェルの履歴に残ります)。参考: [Pushing Images Using the Docker CLI](https://docs.oracle.com/en-us/iaas/Content/Registry/Tasks/registrypushingimagesusingthedockercli.htm)

```sh
NAMESPACE="$(terraform -chdir=infra/envs/stg output -raw object_storage_namespace)"
REGISTRY="nrt.ocir.io"          # 東京(ap-tokyo-1)のリージョンキー。Function と同じリージョンの OCIR を使う

docker login "$REGISTRY" -u "$NAMESPACE/<ユーザー名>"
```

3. イメージをビルドして、タグを付けて push します

```sh
npm run build:functions         # memo-api:local と memo-authorizer:local(linux/arm64)

TAG="$(git rev-parse --short HEAD)"
MEMO_API_IMAGE="$REGISTRY/$NAMESPACE/$(terraform -chdir=infra/envs/stg output -raw memo_api_repository):$TAG"
AUTHORIZER_IMAGE="$REGISTRY/$NAMESPACE/$(terraform -chdir=infra/envs/stg output -raw authorizer_repository):$TAG"

docker tag memo-api:local "$MEMO_API_IMAGE"
docker tag memo-authorizer:local "$AUTHORIZER_IMAGE"
docker push "$MEMO_API_IMAGE"
docker push "$AUTHORIZER_IMAGE"

echo "$MEMO_API_IMAGE"; echo "$AUTHORIZER_IMAGE"   # 手順 4 で tfvars に入れる
```

- リポジトリは Terraform で非公開として作ってあります。Terraform で作っていない名前に push しないよう、名前は `terraform output` から取ります

### 4. 2 回目の apply

`terraform.tfvars` に 3 つの値を入れます。

```hcl
memo_api_image       = "nrt.ocir.io/<namespace>/first-oci-claude-dev-stg/memo-api:<タグ>"
authorizer_image     = "nrt.ocir.io/<namespace>/first-oci-claude-dev-stg/authorizer:<タグ>"
auth_token_secret_id = "<手順 2 で控えたシークレットの OCID>"
```

```sh
terraform -chdir=infra/envs/stg plan -out=stg.tfplan   # Claude Code でも可
terraform -chdir=infra/envs/stg apply stg.tfplan        # 人のみ
```

- 増えるのは、Function×2・API Gateway のデプロイメント・アクセスログと実行ログで、ポリシーは更新(シークレットの読み取りの文が 1 つ増える)になります
- 動的グループやポリシーの反映には少し時間がかかります。直後の呼び出しが `502` になったら、数分待ってから試します
- イメージを更新するときは、新しいタグで push し、tfvars のタグを変えて apply します

### 5. 画面を配置する

リポジトリのルートの `.env` に、配置先を入れます(詳しくは [apps/web/README.md](../apps/web/README.md))。

```sh
cp .env.example .env
# OCI_NAMESPACE = terraform -chdir=infra/envs/stg output -raw object_storage_namespace
# OCI_BUCKET    = terraform -chdir=infra/envs/stg output -raw web_bucket_name
# OCI_PROFILE / OCI_REGION は ~/.oci/config に合わせる

npm run deploy:web -- --dry-run   # 実行されるはずのコマンドを確かめる
npm run deploy:web                # 人のみ
```

### 6. 動作確認

```sh
HOST="$(terraform -chdir=infra/envs/stg output -raw api_gateway_hostname)"

# 画面(認証なし)。ルートは GET だけなので、HEAD(curl -I)ではなく GET でヘッダーを見る
curl -s -o /dev/null -D - "https://$HOST/"            # 200、Content-Type: text/html
# API(トークンなし)
curl -si "https://$HOST/api/memos" | head -n 5        # 401

# API(トークンあり)。トークンは表示せずに読み込む
read -rs TOKEN                                         # パスワードマネージャーから貼り付けて Enter
curl -si -H "Authorization: Bearer $TOKEN" "https://$HOST/api/memos"   # 200、{"items":[],"nextCursor":null}
unset TOKEN
```

- ブラウザで `https://<ホスト名>/` を開き、[apps/web/README.md のチェックリスト](../apps/web/README.md#手動確認のチェックリスト) を確かめます
- ログは、コンソールの「監視および管理」→「ロギング」→「ロググループ」の `first-oci-claude-dev-stg-logs` で見られます(Function の呼び出しログ、API Gateway のアクセスログと実行ログ)
- このとき、SPEC 13 章の未確定事項(3・4・6・7・8・11〜15)を確かめ、結果を SPEC に書きます

## 運用

### PAR の有効期限を延ばす

PAR の期限が切れると、画面が表示されなくなります(API は動き続けます)。`web_par_expires_at` を先の日時に変えて apply します(人のみ)。PAR は作り直され、新しい URL が API Gateway のデプロイメントに入ります。

### 削除する

```sh
npm run clean:web   # 人のみ。バケットは空でないと削除できない
```

1. `terraform.tfvars` に `vault_time_of_deletion` を入れて apply します(人のみ)。Vault と鍵は削除しても猶予期間(7〜30 日。既定 30 日)が過ぎるまで消えないので、最短の 7 日にするためです。値は今から 7 日より少し先の日時にします(例: 7 日と 1 時間後)。apply から destroy までの時間も見込みます

   ```sh
   date -u -v+7d -v+1H +%Y-%m-%dT%H:%M:%SZ   # macOS
   ```

2. `terraform -chdir=infra/envs/stg destroy`(人のみ)

- Vault に入っているシークレット(人が作ったもの)は Terraform の管理外です。Vault と一緒に消えるかは未確認です(SPEC 13 章)
- 削除待ちの Vault と鍵がコンパートメントに残っているあいだ、コンパートメントの削除が失敗するかもしれません(SPEC 13 章)。失敗したら、猶予期間が過ぎてから destroy をもう一度実行します
- `terraform destroy` の直後に同じ名前で作り直すと失敗することがあります(コンパートメントの削除は非同期で時間がかかり、Vault は猶予期間中は残るため)

## 費用

- VCN・Internet Gateway・Service Gateway は無料です
- NoSQL テーブルは Always Free が Phoenix リージョン限定のため、東京では有料のプロビジョンドテーブルを最小構成で作ります
- Vault は共有型 + 鍵 1 本 + シークレット 1 つで月 0 円です(SPEC 13.1)
- Functions・API Gateway・Logging・Object Storage・OCIR の料金は、このリポジトリではまだ確かめていません。個人で試す量なら小さいはずですが、使い始めたら請求の画面で確かめてください
