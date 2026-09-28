output "vault_id" {
  value = oci_kms_vault.this.id
}

output "key_id" {
  value = oci_kms_key.this.id
}
