# 認証情報(鍵・fingerprint・tenancy)は ~/.oci/config のプロファイルから読む
provider "oci" {
  region              = var.region
  config_file_profile = var.oci_config_profile
}
