# Functions と API Gateway の権限(SPEC 9.2)。
#
# 動的グループは対象コンパートメントの Functions 全体を 1 つにまとめる。
# このため memo-api と authorizer は同じ権限を持つ(関数ごとには分けない)。
# 代わりに、ポリシーの条件で対象のテーブルとシークレットに絞る。
#
# 参照した公式ドキュメント:
#   動的グループのルール   https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionsaccessingociresources.htm
#   ポリシーの主体の書き方 https://docs.oracle.com/en-us/iaas/Content/Identity/policysyntax/subject.htm
#   NoSQL                  https://docs.oracle.com/en-us/iaas/nosql-database/doc/policy-reference.html
#   Vault のシークレット   https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/keypolicyreference.htm
#   API Gateway → Functions https://docs.oracle.com/iaas/Content/APIGateway/Tasks/apigatewaycreatingpolicies.htm#dynamicgrouppolicy
#   Object Storage         https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/objectstoragepolicyreference.htm

# 動的グループはテナンシ(ルートコンパートメント)に作る。名前はテナンシの中で一意
resource "oci_identity_dynamic_group" "functions" {
  compartment_id = var.tenancy_ocid
  name           = "${var.name_prefix}-functions"
  description    = "${var.name_prefix} コンパートメントの Functions"
  matching_rule  = "ALL {resource.type = 'fnfunc', resource.compartment.id = '${var.compartment_id}'}"
  freeform_tags  = var.freeform_tags
}

locals {
  # Identity Domains のテナンシでは、名前で書くとドメイン名が要る('<ドメイン>'/'<名前>'。省略すると Default)。
  # OCID で書けばドメインを気にしなくてよい
  functions_subject = "dynamic-group id ${oci_identity_dynamic_group.functions.id}"
  compartment       = "compartment id ${var.compartment_id}"

  statements = concat(
    [
      # memo-api: 対象テーブルの行の読み書き。削除(DeleteRow)まで要るので manage
      "Allow ${local.functions_subject} to manage nosql-rows in ${local.compartment} where target.nosql-table.name = '${var.nosql_table_name}'",
      # API Gateway: このコンパートメントの API Gateway から Functions を呼び出す
      "Allow any-user to use functions-family in ${local.compartment} where ALL {request.principal.type = 'ApiGateway', request.resource.compartment.id = '${var.compartment_id}'}",
    ],
    # authorizer: 対象シークレットの読み取り(GetSecretBundle)。シークレットを人が作るまでは付けない
    var.auth_token_secret_id == null ? [] : [
      "Allow ${local.functions_subject} to read secret-bundles in ${local.compartment} where target.secret.id = '${var.auth_token_secret_id}'",
    ],
    # GitHub Actions からの画面の配置(deploy-web.yml)。UPST の service user が入るグループに、画面用のバケットの
    # オブジェクトの一覧・アップロード・削除を許す。グループを人が作るまでは付けない
    var.deploy_web_group_id == null ? [] : [
      "Allow group id ${var.deploy_web_group_id} to manage objects in ${local.compartment} where target.bucket.name = '${var.web_bucket_name}'",
    ],
  )
}

resource "oci_identity_policy" "this" {
  compartment_id = var.compartment_id
  name           = "${var.name_prefix}-functions-policy"
  description    = "${var.name_prefix} の Functions と API Gateway の権限"
  statements     = local.statements
  freeform_tags  = var.freeform_tags
}
