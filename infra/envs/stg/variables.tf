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
