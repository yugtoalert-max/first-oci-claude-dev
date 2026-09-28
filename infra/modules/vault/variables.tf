variable "compartment_id" {
  description = "Vault と鍵を作るコンパートメントの OCID"
  type        = string
}

variable "name_prefix" {
  description = "リソースの表示名に付ける接頭辞"
  type        = string
}

variable "time_of_deletion" {
  description = "destroy したときに Vault と鍵を削除する日時(RFC 3339)。null なら OCI の既定(30 日後)"
  type        = string
  default     = null
}

variable "freeform_tags" {
  description = "全リソースに付けるタグ"
  type        = map(string)
  default     = {}
}
