output "compartment_id" {
  value = oci_identity_compartment.this.id
}

output "vcn_id" {
  value = module.network.vcn_id
}

output "public_subnet_id" {
  value = module.network.public_subnet_id
}

output "private_subnet_id" {
  value = module.network.private_subnet_id
}

output "nosql_table_id" {
  value = module.nosql.table_id
}

output "nosql_table_name" {
  value = module.nosql.table_name
}
