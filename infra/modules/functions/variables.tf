variable "compartment_id" {
  description = "リポジトリ・アプリケーションを作るコンパートメントの OCID"
  type        = string
}

variable "name_prefix" {
  description = "リソースの表示名とリポジトリ名に付ける接頭辞"
  type        = string
}

variable "subnet_id" {
  description = "Functions のアプリケーションを置くサブネット(private)の OCID"
  type        = string
}

variable "create_functions" {
  description = "Function を作るか。イメージを OCIR に push するまでは false"
  type        = bool
}

variable "memo_api_image" {
  description = "memo-api のイメージ(<リージョンキー>.ocir.io/<namespace>/<リポジトリ>:<タグ>)。create_functions が false なら null でよい"
  type        = string
  default     = null
}

variable "authorizer_image" {
  description = "authorizer のイメージ。create_functions が false なら null でよい"
  type        = string
  default     = null
}

variable "memo_api_config" {
  description = "memo-api の Function の設定(環境変数)"
  type        = map(string)
  default     = {}
}

variable "authorizer_config" {
  description = "authorizer の Function の設定(環境変数)"
  type        = map(string)
  default     = {}
}

variable "log_group_id" {
  description = "呼び出しログを入れるロググループの OCID"
  type        = string
}

variable "log_retention_days" {
  description = "ログの保持期間(日)"
  type        = number
}

variable "freeform_tags" {
  description = "全リソースに付けるタグ"
  type        = map(string)
  default     = {}
}
