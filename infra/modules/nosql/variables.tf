variable "compartment_id" {
  description = "テーブルを作るコンパートメントの OCID"
  type        = string
}

variable "table_name" {
  description = "テーブル名"
  type        = string
}

variable "read_units" {
  description = "プロビジョンドの読み取りユニット"
  type        = number
}

variable "write_units" {
  description = "プロビジョンドの書き込みユニット"
  type        = number
}

variable "storage_gbs" {
  description = "最大ストレージ容量(GB)"
  type        = number
}

variable "freeform_tags" {
  description = "テーブルに付けるタグ"
  type        = map(string)
  default     = {}
}
