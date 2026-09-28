# 画面(apps/web のビルド成果物)を置くバケット。
# 非公開にして、API Gateway の HTTP バックエンドからだけ PAR 経由で読ませる(SPEC 10.1)。
# オブジェクトのアップロードは Terraform の外(npm run deploy:web)で行う
resource "oci_objectstorage_bucket" "this" {
  compartment_id = var.compartment_id
  namespace      = var.namespace
  name           = var.bucket_name
  access_type    = "NoPublicAccess"
  freeform_tags  = var.freeform_tags
}

# 読み取り専用・一覧不可の PAR。URL にトークンが入るので、値はコミットしない。
# 有効期限を変えると作り直しになり、URL も変わる(API Gateway のデプロイメントも更新される)
resource "oci_objectstorage_preauthrequest" "web" {
  namespace             = var.namespace
  bucket                = oci_objectstorage_bucket.this.name
  name                  = "${var.bucket_name}-read"
  access_type           = "AnyObjectRead"
  bucket_listing_action = "Deny"
  time_expires          = var.par_expires_at
}
