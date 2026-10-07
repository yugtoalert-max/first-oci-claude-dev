variable "tenancy_ocid" {
  description = "テナンシの OCID(動的グループを作る場所)"
  type        = string
}

variable "compartment_id" {
  description = "Functions・API Gateway・NoSQL・シークレットがあるコンパートメントの OCID(ポリシーもここに付ける)"
  type        = string
}

variable "name_prefix" {
  description = "動的グループとポリシーの名前に付ける接頭辞"
  type        = string
}

variable "nosql_table_name" {
  description = "memo-api が読み書きする NoSQL テーブルの名前"
  type        = string
}

variable "auth_token_secret_id" {
  description = "authorizer が読むシークレットの OCID。人が作るまでは null"
  type        = string
  default     = null
}

variable "web_bucket_name" {
  description = "画面用のバケットの名前(GitHub Actions からの配置で、オブジェクトを書き換えてよいバケット)"
  type        = string
}

variable "deploy_web_group_id" {
  description = "GitHub Actions から画面を配置する service user のグループの OCID(Default ドメイン)。人が作るまでは null"
  type        = string
  default     = null
}

variable "freeform_tags" {
  description = "全リソースに付けるタグ"
  type        = map(string)
  default     = {}
}
