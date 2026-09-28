# API Gateway(SPEC 2 章・7 章・8 章・10.1)。
# ゲートウェイは Function に依存しないので先に作る(ホスト名を先に決めるため)。
# デプロイメントは Function の OCID が要るので、Function ができてから(create_deployment = true)作る

resource "oci_apigateway_gateway" "this" {
  compartment_id = var.compartment_id
  display_name   = "${var.name_prefix}-apigw"
  endpoint_type  = "PUBLIC"
  subnet_id      = var.subnet_id
  freeform_tags  = var.freeform_tags
}

locals {
  cors_enabled = length(var.cors_allowed_origins) > 0
}

# 1 つのデプロイメントで、API(認証あり)と画面(認証なし)の両方を配信する
resource "oci_apigateway_deployment" "this" {
  count = var.create_deployment ? 1 : 0

  compartment_id = var.compartment_id
  gateway_id     = oci_apigateway_gateway.this.id
  display_name   = "${var.name_prefix}-deployment"
  path_prefix    = "/"
  freeform_tags  = var.freeform_tags

  specification {
    logging_policies {
      access_log {
        is_enabled = true
      }
      execution_log {
        is_enabled = true
        log_level  = "INFO"
      }
    }

    request_policies {
      # 複数引数の authorizer Function。引数 authorization に Authorization ヘッダーを渡す(SPEC 7 章)。
      # 画面のルートを匿名にするため、匿名のアクセスを許す(認証が要るかはルートごとに決める)
      authentication {
        type                        = "CUSTOM_AUTHENTICATION"
        function_id                 = var.authorizer_function_id
        is_anonymous_access_allowed = true
        parameters = {
          authorization = "request.headers[Authorization]"
        }
        cache_key = ["authorization"]
      }

      # cors_allowed_origins が空(prod)なら CORS のポリシー自体を設定しない(SPEC 8 章)
      dynamic "cors" {
        for_each = local.cors_enabled ? [1] : []

        content {
          allowed_origins              = var.cors_allowed_origins
          allowed_headers              = ["Authorization", "Content-Type", "If-Match"]
          allowed_methods              = ["GET", "POST", "PATCH", "DELETE"]
          exposed_headers              = ["ETag", "Location", "Retry-After"]
          is_allow_credentials_enabled = false
        }
      }
    }

    # ---- API(認証あり) → memo-api ----

    routes {
      path    = "/api/memos"
      methods = ["GET", "POST"]

      backend {
        type        = "ORACLE_FUNCTIONS_BACKEND"
        function_id = var.memo_api_function_id
      }

      request_policies {
        authorization {
          type = "AUTHENTICATION_ONLY"
        }
      }
    }

    routes {
      path    = "/api/memos/{id}"
      methods = ["GET", "PATCH", "DELETE"]

      backend {
        type        = "ORACLE_FUNCTIONS_BACKEND"
        function_id = var.memo_api_function_id
      }

      request_policies {
        authorization {
          type = "AUTHENTICATION_ONLY"
        }
      }
    }

    # ---- 画面(認証なし) → Object Storage(PAR) ----

    routes {
      path    = "/"
      methods = ["GET"]

      backend {
        type = "HTTP_BACKEND"
        url  = "${var.web_base_url}index.html"
      }

      request_policies {
        authorization {
          type = "ANONYMOUS"
        }
      }
    }

    routes {
      path    = "/{path*}"
      methods = ["GET"]

      backend {
        type = "HTTP_BACKEND"
        # $${...} は Terraform の補間ではなく、API Gateway のコンテキスト変数としてそのまま渡す
        url = "${var.web_base_url}$${request.path[path]}"
      }

      request_policies {
        authorization {
          type = "ANONYMOUS"
        }
      }
    }
  }
}

# アクセスログと実行ログ(デプロイメント単位)
resource "oci_logging_log" "deployment" {
  for_each = var.create_deployment ? toset(["access", "execution"]) : toset([])

  display_name       = "${var.name_prefix}-deployment-${each.key}"
  log_group_id       = var.log_group_id
  log_type           = "SERVICE"
  is_enabled         = true
  retention_duration = var.log_retention_days
  freeform_tags      = var.freeform_tags

  configuration {
    compartment_id = var.compartment_id

    source {
      source_type = "OCISERVICE"
      service     = "apigateway"
      resource    = oci_apigateway_deployment.this[0].id
      category    = each.key
    }
  }
}
