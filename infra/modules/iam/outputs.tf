output "dynamic_group_name" {
  value = oci_identity_dynamic_group.functions.name
}

output "policy_id" {
  value = oci_identity_policy.this.id
}
