locals {
  name_prefix = "${var.project_name}-${var.env}"

  freeform_tags = {
    project    = var.project_name
    env        = var.env
    managed_by = "terraform"
  }

  # 2 段階の apply(infra/README.md)。
  # 1 回目はイメージとシークレットがまだないので、Function と API Gateway のデプロイメントを作らない。
  # 人がシークレットを作り、イメージを push して、3 つの値を tfvars に入れてから 2 回目の apply で作る
  second_stage_inputs = [var.memo_api_image, var.authorizer_image, var.auth_token_secret_id]
  create_functions    = alltrue([for v in local.second_stage_inputs : v != null])
}

resource "oci_identity_compartment" "this" {
  compartment_id = var.parent_compartment_ocid
  name           = local.name_prefix
  description    = "${var.project_name} の ${var.env} 環境"
  freeform_tags  = local.freeform_tags

  # false だと destroy しても state から外れるだけで実体が残る
  enable_delete = true
}

module "network" {
  source = "../../modules/network"

  compartment_id      = oci_identity_compartment.this.id
  name_prefix         = local.name_prefix
  vcn_cidr            = var.vcn_cidr
  vcn_dns_label       = "memo${var.env}"
  public_subnet_cidr  = var.public_subnet_cidr
  private_subnet_cidr = var.private_subnet_cidr
  freeform_tags       = local.freeform_tags
}

module "nosql" {
  source = "../../modules/nosql"

  compartment_id = oci_identity_compartment.this.id
  table_name     = var.nosql_table_name
  read_units     = var.nosql_read_units
  write_units    = var.nosql_write_units
  storage_gbs    = var.nosql_storage_gbs
  freeform_tags  = local.freeform_tags
}

# Object Storage の namespace はテナンシから引く(tfvars に書かずに済む)
data "oci_objectstorage_namespace" "this" {
  compartment_id = var.tenancy_ocid

  lifecycle {
    # 一部だけ入れると、黙って 1 回目の状態のままになるので止める
    precondition {
      condition     = alltrue([for v in local.second_stage_inputs : v == null]) || local.create_functions
      error_message = "memo_api_image・authorizer_image・auth_token_secret_id は 3 つとも入れるか、3 つとも省略してください。"
    }
  }
}

module "web_bucket" {
  source = "../../modules/web_bucket"

  compartment_id = oci_identity_compartment.this.id
  namespace      = data.oci_objectstorage_namespace.this.namespace
  bucket_name    = "${local.name_prefix}-web"
  par_expires_at = var.web_par_expires_at
  freeform_tags  = local.freeform_tags
}

module "vault" {
  source = "../../modules/vault"

  compartment_id   = oci_identity_compartment.this.id
  name_prefix      = local.name_prefix
  time_of_deletion = var.vault_time_of_deletion
  freeform_tags    = local.freeform_tags
}

resource "oci_logging_log_group" "this" {
  compartment_id = oci_identity_compartment.this.id
  display_name   = "${local.name_prefix}-logs"
  description    = "${local.name_prefix} の Functions と API Gateway のログ"
  freeform_tags  = local.freeform_tags
}

module "functions" {
  source = "../../modules/functions"

  compartment_id   = oci_identity_compartment.this.id
  name_prefix      = local.name_prefix
  subnet_id        = module.network.private_subnet_id
  create_functions = local.create_functions
  memo_api_image   = var.memo_api_image
  authorizer_image = var.authorizer_image

  # 名前はアプリのコードが読む環境変数(SPEC 9.2)
  memo_api_config = {
    NOSQL_TABLE_NAME     = module.nosql.table_name
    NOSQL_COMPARTMENT_ID = oci_identity_compartment.this.id
  }
  authorizer_config = local.create_functions ? {
    AUTH_TOKEN_SECRET_ID = var.auth_token_secret_id
  } : {}

  log_group_id       = oci_logging_log_group.this.id
  log_retention_days = var.log_retention_days
  freeform_tags      = local.freeform_tags
}

module "iam" {
  source = "../../modules/iam"

  tenancy_ocid         = var.tenancy_ocid
  compartment_id       = oci_identity_compartment.this.id
  name_prefix          = local.name_prefix
  nosql_table_name     = module.nosql.table_name
  auth_token_secret_id = var.auth_token_secret_id
  web_bucket_name      = module.web_bucket.bucket_name
  deploy_web_group_id  = var.deploy_web_group_id
  freeform_tags        = local.freeform_tags
}

module "api_gateway" {
  source = "../../modules/api_gateway"

  compartment_id         = oci_identity_compartment.this.id
  name_prefix            = local.name_prefix
  subnet_id              = module.network.public_subnet_id
  create_deployment      = local.create_functions
  memo_api_function_id   = module.functions.memo_api_function_id
  authorizer_function_id = module.functions.authorizer_function_id
  web_base_url           = module.web_bucket.par_base_url
  cors_allowed_origins   = var.cors_allowed_origins
  log_group_id           = oci_logging_log_group.this.id
  log_retention_days     = var.log_retention_days
  freeform_tags          = local.freeform_tags

  # 呼び出しの権限ができてから、デプロイメントで Function を使う
  depends_on = [module.iam]
}
