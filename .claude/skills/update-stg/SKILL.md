---
name: update-stg
description: stg 環境を main の最新のコードに更新する手順。Claude Code は確認・ビルド・plan とその要約までを行い、push・apply・画面の配置・トークンを使う動作確認は人に頼む。
disable-model-invocation: true
---

# stg を更新する

stg はすでに作ってある前提です(初めて作るときは `infra/README.md` の「手順の全体」を人が進めます)。
この手順は、main の最新のコードを stg に反映するときに使います。

**Claude Code が実行してよいのは、各手順に「Claude Code」と書いたものだけです。** 「人」と書いた手順は、コマンドを示して、人が終わったと言うまで待ちます。

## 1. 前提を確かめる(Claude Code)

1. `git status -sb` で、main にいて未コミットの変更がなく、`origin/main` と一致していることを確かめる。違ったら止めて、人に伝える
2. `npm run typecheck`、`npm test`、`npm run build` を実行し、すべて成功することを確かめる。失敗したら止める
3. 今 stg で動いているイメージのタグ(コミットのハッシュ)を人に聞く。人は tfvars の `memo_api_image` の末尾で確かめられる。**tfvars を読まないこと**
4. `git diff --stat <そのタグ>..HEAD` で、変わった部分を分ける
   - `apps/api/` か `packages/` → Function のイメージを作り直す
   - `apps/web/` か `packages/` → 画面を配置し直す
   - `infra/` → plan に Function 以外の変更が出る
   - どれにも当たらなければ、stg の更新は不要と伝えて終える

## 2. イメージを作る(Claude Code)

Function のイメージを作り直すときだけ行う。Colima が動いていなければ、人に `colima start` を頼む。

```sh
npm run build:functions
```

## 3. イメージを push する(人)

人に次のコマンドを示す。`TAG` は `git rev-parse --short HEAD` の値を入れて示す。namespace やリポジトリの名前は `terraform output` で取るので、**Claude Code は値を調べたり埋めたりしない**。

```sh
NAMESPACE="$(terraform -chdir=infra/envs/stg output -raw object_storage_namespace)"
REGISTRY="nrt.ocir.io"
TAG="<git rev-parse --short HEAD の値>"
MEMO_API_IMAGE="$REGISTRY/$NAMESPACE/$(terraform -chdir=infra/envs/stg output -raw memo_api_repository):$TAG"
AUTHORIZER_IMAGE="$REGISTRY/$NAMESPACE/$(terraform -chdir=infra/envs/stg output -raw authorizer_repository):$TAG"

docker tag memo-api:local "$MEMO_API_IMAGE"
docker tag memo-authorizer:local "$AUTHORIZER_IMAGE"
docker push "$MEMO_API_IMAGE"
docker push "$AUTHORIZER_IMAGE"
```

あわせて、`terraform.tfvars` の `memo_api_image` と `authorizer_image` の末尾のタグを新しい `TAG` に書き換えるよう頼む。`docker login` が切れていたら、`infra/README.md` の手順 3 を案内する。

## 4. plan を確かめる(Claude Code)

人が push と tfvars の更新を終えたら、次を**そのまま**実行する。パイプやリダイレクトを付けると sandbox の中で実行されて失敗する(`.claude/hooks/README.md`)。

```sh
terraform -chdir=infra/envs/stg plan -out=stg.tfplan
```

結果は、件数(`to add` / `to change` / `to destroy`)と、変わるリソースのアドレス(`module.functions.oci_functions_function.this["memo_api"]` など)だけで要約する。**OCID・namespace・URL は報告に書かない。**

- 想定していた変化は、Function 2 つ(`module.functions.oci_functions_function.this["memo_api"]` と `this["authorizer"]`)の `source_details.image` が変わる `to change` だけ
- `to destroy` が 1 以上、または想定していない変更があったら、apply を勧めずに止めて、何が変わるのかを人に説明する

## 5. apply する(人)

```sh
terraform -chdir=infra/envs/stg apply stg.tfplan
rm infra/envs/stg/stg.tfplan    # plan ファイルには秘密情報が平文で入る
```

画面を配置し直すとき(手順 1 の 4)は、続けて次も頼む。

```sh
npm run deploy:web -- --dry-run
npm run deploy:web
```

## 6. 動作確認(人)

`infra/README.md` の「6. 動作確認」の curl を、人にターミナルで実行してもらう(`read -rs` でトークンを読むので、Claude Code の `!` では実行できない)。期待する結果は `/` が 200、`/api/memos` がトークンなしで 401、トークンありで 200。

画面を変えたときは、`apps/web/README.md` の手動確認のチェックリストも頼む。

## 7. 終える(Claude Code)

人から結果を聞いたら、次をまとめて報告する。

- 反映したコミット(`git rev-parse --short HEAD`)と、前のタグ
- plan の件数
- 動作確認の結果(人から聞いたもの)
