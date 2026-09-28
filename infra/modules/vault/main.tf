# 認証トークンを入れる Vault と、シークレットの暗号化に使う鍵(SPEC 7 章)。
# シークレット自体は Terraform で作らない(値を tfstate に残さないため)。人がコンソールか CLI で作る。
#
# Vault と鍵は、削除しても猶予期間(7〜30 日。既定 30 日)が過ぎるまで消えない。
# time_of_deletion は削除する日時で、destroy の前に 7 日より先の日時を入れて apply しておく(infra/README.md)

# 共有型。専用型(VIRTUAL_PRIVATE)は高額なので使わない
resource "oci_kms_vault" "this" {
  compartment_id   = var.compartment_id
  display_name     = "${var.name_prefix}-vault"
  vault_type       = "DEFAULT"
  time_of_deletion = var.time_of_deletion
  freeform_tags    = var.freeform_tags
}

resource "oci_kms_key" "this" {
  compartment_id      = var.compartment_id
  display_name        = "${var.name_prefix}-auth-token-key"
  management_endpoint = oci_kms_vault.this.management_endpoint
  protection_mode     = "HSM"
  time_of_deletion    = var.time_of_deletion
  freeform_tags       = var.freeform_tags

  # AES 256 ビット
  key_shape {
    algorithm = "AES"
    length    = 32
  }
}
