output "bucket_name" {
  value = oci_objectstorage_bucket.this.name
}

# PAR の URL(スキームとホストを含み、末尾は /o/)。後ろにオブジェクト名を付けると、そのオブジェクトを読める。
# URL 自体が読み取りの認証情報なので sensitive にする(plan の表示にも出さない)
output "par_base_url" {
  value     = sensitive(oci_objectstorage_preauthrequest.web.full_path)
  sensitive = true
}
