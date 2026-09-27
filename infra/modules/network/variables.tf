variable "compartment_id" {
  description = "VCN を作るコンパートメントの OCID"
  type        = string
}

variable "name_prefix" {
  description = "リソースの表示名に付ける接頭辞"
  type        = string
}

variable "vcn_cidr" {
  description = "VCN の CIDR"
  type        = string
}

variable "vcn_dns_label" {
  description = "VCN の DNS ラベル(英数字のみ、15 文字以内)"
  type        = string
}

variable "public_subnet_cidr" {
  description = "public サブネット(将来の API Gateway 用)の CIDR"
  type        = string
}

variable "private_subnet_cidr" {
  description = "private サブネット(将来の Functions 用)の CIDR"
  type        = string
}

variable "freeform_tags" {
  description = "全リソースに付けるタグ"
  type        = map(string)
  default     = {}
}
