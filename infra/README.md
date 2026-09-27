# infra

stg 環境(子コンパートメント・VCN・メモ保存用 NoSQL テーブル)を Terraform で作ります。

```
infra/
  modules/network/  VCN・サブネット(public / private)・Internet Gateway・Service Gateway
  modules/nosql/    メモ保存用テーブル(プロビジョンド最小構成: 読み取り 1・書き込み 1・容量 1GB)
  envs/stg/         stg 環境のルートモジュール
```

## 前提

- Terraform 1.5 以上
- OCI CLI の設定(`~/.oci/config`)が済んでいること。provider はこのプロファイルで認証します
- ホームリージョンで実行すること(コンパートメントはホームリージョンでしか作れません)

## 手順

コマンドは `infra/envs/stg` に移動して実行します。

```sh
cd infra/envs/stg

# 1. 変数ファイルを作る(人)。terraform.tfvars は Git 管理外
cp terraform.tfvars.example terraform.tfvars
#    → parent_compartment_ocid に親コンパートメントの OCID を入れる

# 2. 初期化・検証(Claude Code でも可)
terraform init
terraform fmt -check -recursive ../..
terraform validate

# 3. 差分確認(Claude Code でも可)
terraform plan -out=stg.tfplan

# 4. 作成(人のみ)
terraform apply stg.tfplan
```

削除するときは `terraform destroy`(人のみ)。コンパートメントの削除は非同期で時間がかかるため、直後に同じ名前で作り直すと失敗することがあります。

## 費用

VCN・Internet Gateway・Service Gateway は無料です。NoSQL テーブルは Always Free が Phoenix リージョン限定のため、東京では有料のプロビジョンドテーブルを最小構成で作ります。
