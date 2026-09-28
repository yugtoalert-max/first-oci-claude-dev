variable "compartment_id" {
  description = "API Gateway を作るコンパートメントの OCID"
  type        = string
}

variable "name_prefix" {
  description = "リソースの表示名に付ける接頭辞"
  type        = string
}

variable "subnet_id" {
  description = "API Gateway を置くサブネット(public)の OCID"
  type        = string
}

variable "create_deployment" {
  description = "デプロイメントを作るか。Function ができるまでは false"
  type        = bool
}

variable "memo_api_function_id" {
  description = "memo-api の Function の OCID。create_deployment が false なら null でよい"
  type        = string
  default     = null
}

variable "authorizer_function_id" {
  description = "authorizer の Function の OCID。create_deployment が false なら null でよい"
  type        = string
  default     = null
}

variable "web_base_url" {
  description = "画面のファイルを読む PAR の URL(末尾は /)"
  type        = string
  sensitive   = true
}

variable "cors_allowed_origins" {
  description = "CORS で許可するオリジン。空なら CORS のポリシーを設定しない"
  type        = list(string)
  default     = []
}

variable "log_group_id" {
  description = "アクセスログと実行ログを入れるロググループの OCID"
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
