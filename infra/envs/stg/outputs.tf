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

output "object_storage_namespace" {
  value = data.oci_objectstorage_namespace.this.namespace
}

output "web_bucket_name" {
  value = module.web_bucket.bucket_name
}

# PAR の URL は読み取りの認証情報なので sensitive。見るときは terraform output -raw web_par_base_url
output "web_par_base_url" {
  value     = module.web_bucket.par_base_url
  sensitive = true
}

output "vault_id" {
  value = module.vault.vault_id
}

output "vault_key_id" {
  value = module.vault.key_id
}

output "functions_application_id" {
  value = module.functions.application_id
}

output "memo_api_repository" {
  value = module.functions.memo_api_repository
}

output "authorizer_repository" {
  value = module.functions.authorizer_repository
}

output "memo_api_function_id" {
  value = module.functions.memo_api_function_id
}

output "authorizer_function_id" {
  value = module.functions.authorizer_function_id
}

output "api_gateway_hostname" {
  value = module.api_gateway.hostname
}

# 画面の URL。2 回目の apply まで null
output "api_gateway_endpoint" {
  value = module.api_gateway.endpoint
}
