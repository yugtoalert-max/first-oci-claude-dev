locals {
  name_prefix = "${var.project_name}-${var.env}"

  freeform_tags = {
    project    = var.project_name
    env        = var.env
    managed_by = "terraform"
  }
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
