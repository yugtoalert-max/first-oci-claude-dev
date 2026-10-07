# GitHub Actions から画面を配置する(Workload Identity Federation)

`.github/workflows/deploy-web.yml` で、`npm run deploy:web` を GitHub Actions から実行します(SPEC 10.6)。
OCI への認証は Workload Identity Federation(WIF)で行い、**OCI の API キーは GitHub に置きません**。

**この文書の作業(OCI のドメインの設定、`terraform apply`、GitHub の environment と secret の設定、workflow の実行)はすべて人が行います。Claude Code は実行しません。**

実際の値(OCID・namespace・ドメインの URL・client id・GitHub の owner id / repo id)はこの文書にもコミットにも書きません。`<...>` はプレースホルダです。

## 仕組み

```
GitHub Actions(environment: stg)
  │ 1. OIDC トークン(JWT)を取得する。sub = repo:<OWNER>@<OWNER-ID>/<REPO>@<REPO-ID>:environment:stg
  ▼
apps/web/scripts/oci-upst.ts
  │ 2. 鍵ペアを作り、JWT と公開鍵を、ドメインの /oauth2/v1/token で UPST に交換する
  │    (Basic 認証はトークン交換用アプリの client id / secret)
  ▼
アイデンティティドメイン(Default)の Identity Propagation Trust
  │ 3. JWT の署名(GitHub の JWKS)と rule(sub eq ...)を確かめ、service user として UPST を出す
  ▼
OCI CLI(--auth security_token)
  │ 4. UPST と秘密鍵で署名して、バケットのオブジェクトを一覧・アップロード・削除する
  ▼
Object Storage(画面用のバケット)… service user のグループに、このバケットのオブジェクトだけを許すポリシー
```

- GitHub に置くのはトークン交換用アプリの **client secret** です。これだけでは何もできません(GitHub が署名した JWT で、rule に合う sub が要ります)
- 交換の手順は OCI Python SDK の `TokenExchangeSigner`(`oci/auth/signers/token_exchange_signer.py`)と同じです
- 参照した公式ドキュメント
  - OCI: JWT を UPST に交換する https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/json_web_token_exchange.htm
  - GitHub: OIDC https://docs.github.com/en/actions/reference/security/oidc
  - Object Storage のポリシー https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/objectstoragepolicyreference.htm

## 1. OCI 側(人が行う)

ドメインは Default を使います。ドメインの URL(`https://idcs-<...>.identity.oraclecloud.com`)はコンソールの「アイデンティティ」→「ドメイン」→ Default の「ドメイン URL」で確かめます。

### 1.1 service user とグループ

1. Default ドメインにユーザーを作り、**service user**(`serviceUser = true`。パスワードやコンソールへのサインインを持たないユーザー)にする。名前の例: `<project>-stg-deploy-web`
2. グループを作り(例: `<project>-stg-deploy-web`)、この service user だけを入れる
3. 次の 2 つを控える(コミットしない)
   - service user の **id**(SCIM の id。OCID ではない)… 1.3 の `impersonationServiceUsers` で使う
   - グループの **OCID** … 1.4 の tfvars で使う

### 1.2 トークン交換用の confidential app

1. Default ドメインの「統合アプリケーション」で、confidential application を作る
2. クライアントの構成で **client credentials** を許可する。**管理者ロール(app roles)は付けない**
3. アプリを有効化し、client id と client secret を控える(client secret は GitHub の secret にだけ入れる)

### 1.3 Identity Propagation Trust

`trust.json`(Git 管理外の場所に作る。値はプレースホルダを置き換える):

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:oracle:idcs:IdentityPropagationTrust"],
  "name": "<project>-stg-github-actions",
  "type": "JWT",
  "issuer": "https://token.actions.githubusercontent.com",
  "publicKeyEndpoint": "https://token.actions.githubusercontent.com/.well-known/jwks",
  "oauthClients": ["<トークン交換用アプリの client id>"],
  "active": true,
  "allowImpersonation": true,
  "impersonationServiceUsers": [
    {
      "rule": "sub eq repo:<OWNER>@<OWNER-ID>/<REPO>@<REPO-ID>:environment:stg",
      "value": "<service user の id>"
    }
  ]
}
```

```sh
oci identity-domains identity-propagation-trust create \
  --endpoint <ドメインの URL> \
  --from-json file://trust.json
```

- `active` の既定は `false` です。`true` にしないと交換できません
- rule の `<OWNER-ID>` / `<REPO-ID>` は数字の ID です。このリポジトリは immutable な sub(`OWNER@OWNER-ID/REPO@REPO-ID`)の対象なので、名前だけの sub では一致しません。次で確かめます

  ```sh
  gh api repos/<owner>/<repo>/actions/oidc/customization/sub   # sub の形(既定か、カスタマイズ済みか)
  gh api repos/<owner>/<repo> --jq '.owner.id, .id'            # owner id と repo id
  ```

- 実際に届いた sub と aud は、workflow のログの `GitHub OIDC token: sub=... aud=...` の行で確かめられます
- rule に `*` も使えますが、使いません(どのリポジトリ・ブランチの JWT でも service user になれてしまうため)

### 1.4 ポリシー(Terraform。apply は人)

`infra/envs/stg/terraform.tfvars` に、1.1 のグループの OCID を入れて apply します。

```hcl
deploy_web_group_id = "<グループの OCID>"
```

```sh
terraform -chdir=infra/envs/stg plan    # 足されるのはポリシーの文 1 つだけのはず
terraform -chdir=infra/envs/stg apply
```

足される文: `Allow group id <グループ> to manage objects in compartment id <stg コンパートメント> where target.bucket.name = '<画面用のバケット>'`

## 2. GitHub 側(人が行う)

### 2.1 environment `stg`

リポジトリの Settings → Environments で `stg` を作り、**Deployment branches and tags** を「Selected branches and tags」にして `main` だけを許可します。
OIDC トークンの sub が `...:environment:stg` になるのは、このジョブが environment `stg` を使うからです。

### 2.2 environment secret

すべて environment `stg` の secret に入れます(リポジトリの secret ではなく)。public リポジトリなので、ログに出る値も secret にしておくと `***` に置き換わります。

| 名前 | 値 | 使うところ |
|---|---|---|
| `OCI_DOMAIN_URL` | Default ドメインの URL(`https://` から) | トークン交換 |
| `OCI_TOKEN_EXCHANGE_CLIENT_ID` | 1.2 のアプリの client id | トークン交換 |
| `OCI_TOKEN_EXCHANGE_CLIENT_SECRET` | 1.2 のアプリの client secret | トークン交換 |
| `OCI_TENANCY_OCID` | テナンシの OCID | OCI CLI の設定 |
| `OCI_REGION` | リージョンの識別子(例: `ap-tokyo-1`) | OCI CLI の設定・配置先 |
| `OCI_NAMESPACE` | Object Storage の namespace | 配置先 |
| `OCI_BUCKET` | 画面用のバケットの名前 | 配置先 |

`gh` で入れるときは、値をコマンドラインに書かずに標準入力から渡します(例: `gh secret set OCI_TOKEN_EXCHANGE_CLIENT_SECRET --env stg` を実行して貼り付ける)。

### 2.3 pipx

workflow は `pipx install oci-cli==3.92.1` で OCI CLI を入れます。`ubuntu-latest` のイメージに pipx が入っている前提です。
入っているかは、ランナーのイメージの一覧(https://github.com/actions/runner-images の Ubuntu の README)で確かめます。なくなっていれば「Install OCI CLI」の手順が `pipx: command not found` で失敗するので、`pip install --user pipx` などを足します。

## 3. 実行と確認(人が行う)

```sh
gh workflow run deploy-web.yml --ref main
gh run watch
```

Actions の画面の「Run workflow」からでも実行できます。

ログで確かめること:

- `GitHub OIDC token: sub=repo:<OWNER>@<OWNER-ID>/<REPO>@<REPO-ID>:environment:stg aud=...` … rule と同じ sub か
- `UPST expires at ... (in N min)` … UPST の有効期限(公式文書に記載がないので、ここで確かめる。SPEC 13 章)
- `# 完了: アップロード N 件、削除 N 件` … 手元の `npm run deploy:web` と同じ出力
- secret の値・JWT・UPST が `***` になっていて、そのまま出ていないこと

否定の確認(止まるべきところで止まるか):

- main 以外のブランチで実行する(`gh workflow run deploy-web.yml --ref <別のブランチ>`)と、environment の規則でジョブが始まらない
- trust の rule を別の値(例: `environment:prod`)に変えると、交換が `Token exchange failed (HTTP ...)` で失敗する。確かめたら元に戻す
- (余裕があれば)ポリシーの対象外のバケットを `OCI_BUCKET` に入れると、一覧で権限エラーになる

## 4. 取り消し(人が行う)

漏えいが疑われるときや、使わなくなったとき:

| 止めたいもの | 操作 |
|---|---|
| すべての交換 | Identity Propagation Trust を無効にする(`active` を `false`)か削除する |
| client secret の漏えい | トークン交換用アプリの client secret を再生成し、GitHub の secret を入れ替える。急ぐならアプリを無効化する |
| 配置の権限 | tfvars の `deploy_web_group_id` を消して apply する(ポリシーの文が消える)。service user をグループから外す |
| 発行済みの UPST | 期限が切れるまで有効。上のどれかで新しい発行を止め、期限を待つ(期限は 3 のログで確かめた値) |
