# メモ保存用テーブル。
# Always Free テーブルは Phoenix リージョンでしか作れないため、有料のプロビジョンドを最小構成で作る。
resource "oci_nosql_table" "this" {
  compartment_id = var.compartment_id
  name           = var.table_name
  freeform_tags  = var.freeform_tags

  ddl_statement = <<-EOT
    CREATE TABLE IF NOT EXISTS ${var.table_name} (
      id STRING,
      title STRING,
      body STRING,
      created_at TIMESTAMP(3),
      updated_at TIMESTAMP(3),
      PRIMARY KEY (id)
    )
  EOT

  table_limits {
    capacity_mode      = "PROVISIONED"
    max_read_units     = var.read_units
    max_write_units    = var.write_units
    max_storage_in_gbs = var.storage_gbs
  }
}
