variable "compartment_id" {
  description = "バケットを作るコンパートメントの OCID"
  type        = string
}

variable "namespace" {
  description = "Object Storage の namespace"
  type        = string
}

variable "bucket_name" {
  description = "バケット名(namespace の中で一意)"
  type        = string
}

variable "par_expires_at" {
  description = "PAR の有効期限(RFC 3339)。過ぎると画面の配信が止まる"
  type        = string
}

variable "freeform_tags" {
  description = "バケットに付けるタグ"
  type        = map(string)
  default     = {}
}
