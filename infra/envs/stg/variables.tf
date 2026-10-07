variable "parent_compartment_ocid" {
  description = "stg コンパートメントを作る親コンパートメント(このリポジトリ専用)の OCID"
  type        = string
}

variable "region" {
  description = "リージョン。コンパートメントはホームリージョンでしか作れない"
  type        = string
  default     = "ap-tokyo-1"
}

variable "oci_config_profile" {
  description = "~/.oci/config のプロファイル名"
  type        = string
  default     = "DEFAULT"
}

variable "project_name" {
  description = "命名とタグに使うプロジェクト名"
  type        = string
  default     = "first-oci-claude-dev"
}

variable "env" {
  description = "環境名"
  type        = string
  default     = "stg"

  validation {
    condition     = contains(["stg", "prod"], var.env)
    error_message = "env は stg か prod を指定してください。"
  }
}

variable "vcn_cidr" {
  description = "VCN の CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "public サブネットの CIDR"
  type        = string
  default     = "10.0.0.0/24"
}

variable "private_subnet_cidr" {
  description = "private サブネットの CIDR"
  type        = string
  default     = "10.0.1.0/24"
}

variable "nosql_table_name" {
  description = "メモ保存用 NoSQL テーブル名"
  type        = string
  default     = "memos"
}

variable "nosql_read_units" {
  description = "NoSQL テーブルの読み取りユニット"
  type        = number
  default     = 1
}

variable "nosql_write_units" {
  description = "NoSQL テーブルの書き込みユニット"
  type        = number
  default     = 1
}

variable "nosql_storage_gbs" {
  description = "NoSQL テーブルの最大ストレージ容量(GB)"
  type        = number
  default     = 1
}

variable "tenancy_ocid" {
  description = "テナンシの OCID。動的グループを作る場所と、Object Storage の namespace を引くのに使う"
  type        = string
}

variable "web_par_expires_at" {
  description = "画面を配信する PAR の有効期限(RFC 3339。例: 2027-03-31T00:00:00Z)。過ぎると画面が表示されなくなる"
  type        = string

  validation {
    condition     = can(formatdate("YYYY", var.web_par_expires_at))
    error_message = "web_par_expires_at は RFC 3339 の日時で指定してください(例: 2027-03-31T00:00:00Z)。"
  }
}

variable "cors_allowed_origins" {
  description = "CORS で許可するオリジン。stg は手元の開発サーバー、prod は空(空なら CORS を設定しない)"
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.cors_allowed_origins, "*")
    error_message = "cors_allowed_origins に * は使えません。オリジンを個別に指定してください。"
  }
}

variable "log_retention_days" {
  description = "Functions と API Gateway のログの保持期間(日)。30 日単位で 180 日まで"
  type        = number
  default     = 30

  validation {
    condition     = contains([30, 60, 90, 120, 150, 180], var.log_retention_days)
    error_message = "log_retention_days は 30・60・90・120・150・180 のどれかにしてください。"
  }
}

variable "vault_time_of_deletion" {
  description = "destroy したときに Vault と鍵を削除する日時(RFC 3339)。destroy の前に 7 日より少し先の日時を入れて apply する。null なら OCI の既定(30 日後)"
  type        = string
  default     = null

  validation {
    condition     = var.vault_time_of_deletion == null || can(formatdate("YYYY", var.vault_time_of_deletion))
    error_message = "vault_time_of_deletion は RFC 3339 の日時で指定してください。"
  }
}

variable "deploy_web_group_id" {
  description = "GitHub Actions から画面を配置する service user のグループの OCID(Default ドメインに人が作る。docs/deploy-web-wif.md)。作るまでは null"
  type        = string
  default     = null
}

# ---- 2 回目の apply で入れる値(3 つとも入れるか、3 つとも省略する) ----

variable "memo_api_image" {
  description = "memo-api のイメージ(<リージョンキー>.ocir.io/<namespace>/<リポジトリ>:<タグ>)。push するまでは null"
  type        = string
  default     = null
}

variable "authorizer_image" {
  description = "authorizer のイメージ。push するまでは null"
  type        = string
  default     = null
}

variable "auth_token_secret_id" {
  description = "認証トークンを入れた Vault のシークレットの OCID。人が作るまでは null"
  type        = string
  default     = null
}
