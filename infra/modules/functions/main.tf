# memo-api と authorizer の Function(SPEC 9.2・9.5)。
# イメージは人が OCIR に push するので、イメージがまだないあいだ(create_functions = false)は
# リポジトリとアプリケーションだけを作り、Function は作らない

locals {
  functions = {
    memo_api = {
      name   = "memo-api"
      image  = var.memo_api_image
      config = var.memo_api_config
    }
    authorizer = {
      name   = "authorizer"
      image  = var.authorizer_image
      config = var.authorizer_config
    }
  }
}

# イメージの置き場(OCIR)。非公開
resource "oci_artifacts_container_repository" "this" {
  for_each = local.functions

  compartment_id = var.compartment_id
  display_name   = "${var.name_prefix}/${each.value.name}"
  is_public      = false
  freeform_tags  = var.freeform_tags
}

# シェイプは GENERIC_ARM(イメージは linux/arm64 でビルドする)。private サブネットに置く
resource "oci_functions_application" "this" {
  compartment_id = var.compartment_id
  display_name   = "${var.name_prefix}-app"
  shape          = "GENERIC_ARM"
  subnet_ids     = [var.subnet_id]
  freeform_tags  = var.freeform_tags
}

resource "oci_functions_function" "this" {
  for_each = var.create_functions ? local.functions : {}

  application_id     = oci_functions_application.this.id
  display_name       = each.value.name
  memory_in_mbs      = "256"
  timeout_in_seconds = 30
  config             = each.value.config
  freeform_tags      = var.freeform_tags

  source_details {
    source_type = "CONTAINER_IMAGE"
    image       = each.value.image
  }
}

# Function の呼び出しログ(アプリケーション単位。console.log の出力もここに入る)
resource "oci_logging_log" "invoke" {
  display_name       = "${var.name_prefix}-app-invoke"
  log_group_id       = var.log_group_id
  log_type           = "SERVICE"
  is_enabled         = true
  retention_duration = var.log_retention_days
  freeform_tags      = var.freeform_tags

  configuration {
    compartment_id = var.compartment_id

    source {
      source_type = "OCISERVICE"
      service     = "functions"
      resource    = oci_functions_application.this.id
      category    = "invoke"
    }
  }
}
