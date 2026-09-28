output "application_id" {
  value = oci_functions_application.this.id
}

# push 先のリポジトリ名(<namespace>/ の後ろに付ける部分)
output "memo_api_repository" {
  value = oci_artifacts_container_repository.this["memo_api"].display_name
}

output "authorizer_repository" {
  value = oci_artifacts_container_repository.this["authorizer"].display_name
}

# Function を作っていないあいだは null
output "memo_api_function_id" {
  value = try(oci_functions_function.this["memo_api"].id, null)
}

output "authorizer_function_id" {
  value = try(oci_functions_function.this["authorizer"].id, null)
}
