# モジュールは使える最低の版だけを書く。版の固定はルート(envs/*)で行う
terraform {
  required_version = ">= 1.5"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 9.3.0"
    }
  }
}
