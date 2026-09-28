output "hostname" {
  value = oci_apigateway_gateway.this.hostname
}

# 画面の URL(https://<ホスト名>/)。デプロイメントを作っていないあいだは null
output "endpoint" {
  value = try(oci_apigateway_deployment.this[0].endpoint, null)
}
