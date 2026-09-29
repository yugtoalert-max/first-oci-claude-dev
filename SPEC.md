# SPEC: メモ API とフロントエンド

メモを作成・一覧・取得・更新・削除する小さな Web API と、それを使う簡易フロントエンドの仕様。
実装担当はこのファイルだけ読めば着手できることを目指す。

## 0. この文書の読み方

各項目には次のどちらかの状態が付く。印のない記述はすべて「決定」とする。

| 表記 | 意味 |
|---|---|
| (決定) | インタビューで合意済み。変更するときは仕様の更新から行う |
| **(仮置き)** | 合意の流れから置いた値。実装で困ったら変えてよいが、変えたら SPEC.md も更新する |

検証が必要で、まだ結論が出ていない事項は「[13. 未確定事項](#13-未確定事項要検証)」にまとめる。

リポジトリの共通ルール(CLAUDE.md)も合わせて守ること。特に、OCID・namespace・URL などの環境固有の値はコミットしない。

## 1. 概要

- 利用者は 1 人(自分だけ)。全メモを 1 人で共有する前提で、所有者の概念はない
- 実行環境: OCI Functions + API Gateway。保存先: OCI NoSQL Database
- 言語: TypeScript。ビジネスロジックは Functions の入出力から切り離し、テストを先に書く
- クライアント: ブラウザで動く簡易フロントエンド(同じ API Gateway から配信)
- 環境: stg と prod。**仕様は両環境で同一**で、違ってよいのは「[11. 環境で変わってよい値](#11-環境で変わってよい値)」に挙げた設定値だけ

## 2. 全体構成

```
ブラウザ
  │  https://<API Gateway のホスト名>/            … 同一オリジン
  ▼
API Gateway(public サブネット、1 つのデプロイメント)
  ├─ /api/memos, /api/memos/{id}  ──(認証: authorizer Function)──▶ memo-api Function(private サブネット)
  │                                                                     │ Service Gateway 経由
  │                                                                     ▼
  │                                                                  NoSQL テーブル memos
  └─ /, /{path*}(静的ファイル、認証なし) ──▶ HTTP バックエンド ──▶ Object Storage バケット(PAR 経由)

authorizer Function ──▶ OCI Vault のシークレット(認証トークン)
```

- Function は **memo-api**(CRUD 全部)と **authorizer**(トークン照合)の 2 つ。コンテナイメージも 2 つ
  - memo-api は 1 つの Function で全ルートを受け、ルーティングはアダプター層で行う。理由: イメージの push は人の手作業なので数を減らしたい。コールドスタートも 1 つに集まる
- フロントエンドと API が同じオリジンなので、**本番運用では CORS は不要**。CORS は stg で手元の開発サーバーから呼ぶためだけに使う([8 章](#8-cors))
- ネットワーク(VCN・サブネット・Service Gateway)と NoSQL テーブルは `infra/` に作成済み。Functions・API Gateway・Vault・バケット・コンテナリポジトリ・IAM・ログは、第6回で `infra/` の Terraform に追加した([9.6](#96-インフラterraform仮置き))

### 2.1 リポジトリ構成(仮置き)

npm workspaces を使う。

```
packages/core/     ドメイン: 型、バリデーション、ユースケース、ポート(インターフェース)、エラーコード
                   API と Web の両方が使う(入力上限・エラーコードを共有するため)
apps/api/          Functions
  memo-api/        アダプター層(HTTP ⇔ ユースケース)+ NoSQL リポジトリ実装 + func.yaml
  authorizer/      authorizer Function + func.yaml
apps/web/          フロントエンド(Vite + TypeScript、フレームワークなし)
infra/             Terraform(既存)
```

- TypeScript は `strict: true`
  - `packages/core` と `apps/api/*` は Node.js の型(`@types/node`)を使い、tsconfig の `lib` に DOM を入れない **(仮置き)**。core のブラウザでの型は、フロントエンドの tsconfig で検査する
  - `apps/web` は `lib` に `DOM` と `DOM.Iterable` を入れ、`types` は `vite/client` だけにする(`@types/node` は入れない)**(仮置き)**
- テストランナーは Vitest
- Node.js のバージョンは 24(OCI Functions の Node.js の既定)。Function の実行環境は、ベースイメージ `fnproject/node:24` で固定する
  - 手元の開発環境のバージョンは固定しない(`engines` や `.nvmrc` を置かない)。esbuild の出力の対象(`target`)を `node24` にして、実行環境に合わせる **(仮置き)**

## 3. データモデル

### 3.1 テーブル(既存。変更しない)

`infra/modules/nosql/main.tf` の定義:

| 列 | 型 | 備考 |
|---|---|---|
| `id` | STRING | 主キー。ULID |
| `title` | STRING | |
| `body` | STRING | |
| `created_at` | TIMESTAMP(3) | UTC |
| `updated_at` | TIMESTAMP(3) | UTC |

- 容量はプロビジョンド最小(読み取り 1・書き込み 1・1GB)。**この容量が API の上限値を決める制約になっている**(5 章・13 章)
- セカンダリインデックスは追加しない。並び順は `id`(ULID)で実現する

### 3.2 ID

- ULID(26 文字、Crockford Base32、大文字)
- サーバー側で生成する。クライアントから id は指定できない
- 同一プロセス内で同じミリ秒に複数生成したときも順序が保たれるよう、単調増加する生成器を使う **(仮置き)**。Function インスタンスをまたいだ同一ミリ秒の順序は保証しない
- 形式チェック: `^[0-9A-HJKMNP-TV-Z]{26}$`。小文字は受け付けない(形式違いとして扱う)**(仮置き)**

### 3.3 時刻

- `createdAt` / `updatedAt` はサーバーが設定する。クライアントからは指定できない
- `createdAt` と ULID の時刻部分は、**同じ Clock から得た同じ時刻**で作る
- 作成時は `updatedAt = createdAt`
- 更新時は、値が変わらなくても `updatedAt` を更新する(比較のために余計な処理をしない)
- API での表現は UTC の ISO 8601、ミリ秒付き。例: `2026-09-28T01:23:45.678Z`

### 3.4 バージョン(楽観ロック)

- NoSQL の行バージョン(バイナリ)を base64url にした文字列を、ドメインでは中身を見ない文字列(opaque)として扱う
  - リポジトリが作れない形の文字列(base64url として読めない、または Buffer に戻して base64url にし直すと元と一致しない)は、どの行のバージョンとも一致しないものとして扱う **(仮置き)**。NoSQL には渡さない。更新は `conflict`、削除は行の有無を読み取って `not_found` か `conflict` にする
- HTTP では強い ETag として返す: `ETag: "<base64url>"`(ダブルクォートで囲む。`W/` は付けない)
- ETag はレスポンスヘッダーだけで返し、ボディには含めない。一覧の各要素にも含めない

## 4. API 仕様

### 4.1 共通

- ベースパス: `/api` **(仮置き)**
- 認証: すべての `/api/*` は `Authorization: Bearer <token>` が必要([7 章](#7-認証))
- リクエストのボディ: `Content-Type: application/json`(`charset` 付きも可)。それ以外は `415`
  - `Content-Type` はメディアタイプ(`;` より前)だけを大文字・小文字を区別せずに比べ、`charset` などのパラメーターの値は見ない **(仮置き)**。`application/merge-patch+json` なども `415`
  - ボディを受け取らないメソッド(GET・DELETE)では `Content-Type` を見ない
- レスポンス
  - 成功は `application/json`、エラーは `application/problem+json`
  - JSON のキーは camelCase
  - API のレスポンスには `Cache-Control: no-store` を付ける **(仮置き)**。`204` やエラーにも付ける
- 定義していないキーがリクエストのボディにあれば `400`(`VALIDATION_FAILED`)。誤字を早く見つけるため
- ボディが JSON のオブジェクトでない場合(配列・`null`・文字列など)は `400`(`VALIDATION_FAILED`、`field` は `""`、`reason` は `INVALID_TYPE`)**(仮置き)**
- 空のボディは JSON として解析できないので `400`(`INVALID_JSON`)
- クエリ文字列の未定義のキーは無視する。同じキーが複数あれば最初の値を使う **(仮置き)**
- ヘッダー名の大文字・小文字は区別しない

### 4.2 メモの表現

完全な形(取得・作成・更新のレスポンス):

```json
{
  "id": "01J8Z3K5Q7W9X2Y4Z6A8B0C2D4",
  "title": "買い物",
  "body": "牛乳\n卵",
  "createdAt": "2026-09-28T01:23:45.678Z",
  "updatedAt": "2026-09-28T01:23:45.678Z"
}
```

一覧の要素(本文を含まない):

```json
{ "id": "...", "title": "...", "createdAt": "...", "updatedAt": "..." }
```

### 4.3 エンドポイント

| メソッド | パス | 成功時 | 概要 |
|---|---|---|---|
| POST | `/api/memos` | `201` | 作成 |
| GET | `/api/memos` | `200` | 一覧(新しい順、カーソルでページ分割) |
| GET | `/api/memos/{id}` | `200` | 取得 |
| PATCH | `/api/memos/{id}` | `200` | 部分更新(`If-Match` 必須) |
| DELETE | `/api/memos/{id}` | `204` | 物理削除(`If-Match` 任意) |

#### POST /api/memos

- ボディ: `{ "title": string, "body"?: string }`
  - `body` を省略したら `""` として扱う **(仮置き)**
- 成功: `201`。ヘッダーは `Location: /api/memos/{id}` と `ETag`。ボディはメモの完全な形

#### GET /api/memos

- クエリ
  - `limit`: 1〜50 の整数。既定 20。範囲外や整数でない値は `400`
    - 10 進の整数として読めない値(`1.5`、`abc`、空文字など)は `reason` が `INVALID_FORMAT`、整数だが範囲外(`0`、`51`、負の数)は `OUT_OF_RANGE` **(仮置き)**
  - `cursor`: 前のレスポンスの `nextCursor`。省略すると先頭から
- 成功: `200`

  ```json
  { "items": [ /* 一覧の要素 */ ], "nextCursor": "..." }
  ```

  - 並び順は `id` の降順(ULID なので新しく作った順)
  - 最後のページでは `nextCursor` は `null`
- カーソルは中身を見せない文字列(opaque)。形式は `base64url(JSON.stringify({ v: 1, after: "<最後に返した id>" }))` **(仮置き)**
  - クライアントはカーソルの中身を解釈しないこと
  - 復号できない値、または `after` が ULID の形式でない値は `400`(`VALIDATION_FAILED`、field は `cursor`)
- 実装方針: `id < after` の条件で `ORDER BY id DESC` を付け、`limit + 1` 件を取得する。`limit + 1` 件目があれば次のページがあると判断する
  - PK 単独のテーブルで `ORDER BY id DESC` がどう振る舞うか(順序、`LIMIT` との組み合わせ)は、リポジトリの契約テストで KVLite に対して確認する([9.3](#93-テスト方針))
- 返す列は `id, title, created_at, updated_at` だけ。本文を返さない理由は、16KB の本文を 20 件返すと読み取り 1 ユニットの上限を大きく超えるため。ただし列を絞っても読み取りコストが減るかは未確定([13 章](#13-未確定事項要検証) の 1)

#### GET /api/memos/{id}

- 成功: `200` + `ETag` + メモの完全な形
- id が ULID の形式でない場合、または存在しない場合は `404`(両者を区別しない)

#### PATCH /api/memos/{id}

- ヘッダー: `If-Match: "<etag>"` が必須
  - 省略したら `428`
  - 値は ETag を 1 つだけ受け付ける。`*` や複数の値は `400`(`VALIDATION_FAILED`、field は `If-Match`)**(仮置き)**
    - 受け付ける形は、ダブルクォートで囲んだ強い ETag 1 つ(中身は RFC 9110 の etagc で 1 文字以上)。前後の空白は無視する。`reason` は `INVALID_FORMAT` **(仮置き)**
    - 次も同じく `400`: `W/` 付き(弱い ETag)、ダブルクォートなし、空の ETag(`""`)、`If-Match` ヘッダーが複数行で届いたとき **(仮置き)**
- ボディ: `{ "title"?: string, "body"?: string }`。指定したキーだけを変える
  - `{}`(変更する項目がない)は `400`
  - `null` は `400`(`title: null` も `body: null` も)
  - `body: ""` は許可する
- 成功: `200` + 新しい `ETag` + 更新後のメモの完全な形
- 処理の流れ: 取得 → 存在しなければ `404` → バージョンが一致しなければ `412` → 条件付きの書き込み(行バージョンが一致するときだけ書く) → 書き込み時にバージョンが一致しなかった場合(競合)も `412`
  - 部分更新なので、既存の値を読むために「読み取り 1 回 + 書き込み 1 回」がかかる

#### DELETE /api/memos/{id}

- ヘッダー: `If-Match` は任意。付いていれば PATCH と同じ規則で照合し、一致しなければ `412`
- 物理削除する。成功: `204`(ボディなし)
- 存在しない id は `404`(`If-Match` の有無にかかわらず)
- 404 と 412 の扱いは PATCH と揃える

### 4.4 判定の順序

同じリクエストが複数のエラー条件に当てはまるとき、上から順に判定して最初に当たったものを返す。テストはこの順序を前提に書く **(仮置き)**。

1. 認証(API Gateway と authorizer。Function には届かない)→ `401`
2. パスの id の形式 → `404`
3. `If-Match` の欠落(PATCH)→ `428`。`If-Match` の形式 → `400`
4. `Content-Type`(ボディを受け取るメソッド)→ `415`
5. JSON として解析できるか → `400`(`INVALID_JSON`)
6. 値の検証(キー・型・長さ・クエリ・カーソル)→ `400`(`VALIDATION_FAILED`)
7. 存在確認 → `404`
8. バージョンの照合 → `412`
9. NoSQL のスロットリング(リトライしても通らない)→ `429`
10. その他の失敗 → `500`

## 5. 入力の検証

| 項目 | 規則 |
|---|---|
| `title` | 文字列。必須(POST)。前後の空白を除いた長さが 1 以上。最大 200 文字 |
| `body` | 文字列。最大 16KB = **UTF-8 で 16,384 バイト**。空文字は可 |

- `title` の「文字数」は Unicode のコードポイント数で数える(`[...s].length`)**(仮置き)**
- 保存するときに、前後の空白の除去や Unicode 正規化はしない(受け取ったまま保存する)**(仮置き)**
- 上限値は `packages/core` に定数として置き、API とフロントエンドの両方で使う
- body の上限を 16KB にしたのは、書き込み 1 ユニット(1 秒あたり約 1KB)の制約からの判断。16KB の書き込みで実際にどうなるかは未確定([13 章](#13-未確定事項要検証) の 2)

## 6. エラー

### 6.1 形式

RFC 9457(`application/problem+json`)に `code` を追加した形。クライアントとテストは `code` で判定する。

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "detail": "Request body is invalid.",
  "errors": [
    { "field": "title", "reason": "TOO_LONG" }
  ]
}
```

- `errors` は `VALIDATION_FAILED` のときだけ付ける
- `field` の値: `title` / `body` / `limit` / `cursor` / `If-Match` / 未定義のキーの名前 / `""`(リクエスト全体に対するエラー。`NO_CHANGES` とボディが非オブジェクトの `INVALID_TYPE`)
- `reason` の値 **(仮置き)**: `REQUIRED` / `INVALID_TYPE` / `BLANK` / `TOO_LONG` / `OUT_OF_RANGE` / `INVALID_FORMAT` / `UNKNOWN_FIELD` / `NO_CHANGES`(PATCH の `{}`。リクエスト全体に対するエラーなので `field` は `""`)
- `500` のレスポンスには内部の詳細(例外のメッセージ、スタックトレース)を含めない

### 6.2 エラーコード一覧

| code | status | 条件 |
|---|---|---|
| `INVALID_JSON` | 400 | ボディを JSON として解析できない |
| `VALIDATION_FAILED` | 400 | 値の検証に失敗(`errors` 付き) |
| `UNAUTHORIZED` | 401 | 認証失敗。**API Gateway が返すため、ボディが problem+json になる保証はない**。クライアントはステータスコードで判定する |
| `NOT_FOUND` | 404 | id の形式が不正、または存在しない |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `Content-Type` が JSON でない |
| `PRECONDITION_FAILED` | 412 | `If-Match` がバージョンと一致しない、または書き込み時に競合した |
| `PRECONDITION_REQUIRED` | 428 | PATCH に `If-Match` がない |
| `THROTTLED` | 429 | NoSQL のスロットリングがリトライしても解消しない。`Retry-After` を付ける |
| `INTERNAL` | 500 | その他 |

- `Retry-After` の値は秒数で `1` **(仮置き)**
- 定義していないルートやメソッドへのリクエストは API Gateway が `404` などを返す。ボディの形式は保証しない
  - それでも memo-api に届いた場合、アダプター層はパス違いもメソッド違いも `404`(`NOT_FOUND`、problem+json)を返す。`405` は使わない **(仮置き)**。末尾に `/` が付いたパスも定義していないルートとして扱う

## 7. 認証

- 方式: 固定の Bearer トークン。利用者は 1 人
- 照合する場所: API Gateway の **authorizer Function**。認証に失敗したリクエストは memo-api まで届かない
  - `/api/*` のルートは認証必須。静的ファイルのルートは認証なし(匿名)
  - OPTIONS(ブラウザが本リクエストの前に送る事前確認。プリフライト)は API Gateway の CORS 設定で応答し、authorizer を通さない
- トークンの保管先: **OCI Vault のシークレット**
  - Vault と鍵は Terraform で作る
  - Vault は**共有型(`vault_type = DEFAULT`)**を使う。専用型の Virtual Private Vault は 1 時間 ¥577.22(月 約42万円)と高額なので使わない
  - 共有型 Vault + 鍵 1 本 + シークレット 1 つなら月 0 円に収まる([13.1](#131-確認済み事項))
  - **シークレットの値は人がコンソールか CLI で登録・更新する。Terraform には値を渡さない**(tfstate に平文を残さないため)。Terraform にはシークレットの OCID だけを `*.tfvars` で渡す **(仮置き)**
  - stg と prod で別のトークンを使う
  - トークンは 32 バイト以上の乱数を base64url にしたもの **(仮置き)**
- authorizer の動作
  - `Authorization: Bearer <token>` を取り出し、シークレットの値と**タイミング攻撃に強い比較**(`crypto.timingSafeEqual`)で照合する
  - シークレットの値はモジュールのスコープに 5 分キャッシュする **(仮置き)**。トークンを替えても、最大でこの時間だけ古いトークンが通る
  - API Gateway 側で認証結果をキャッシュする時間も 5 分 **(仮置き)**
  - 2 つのキャッシュは重なるので、トークンを替えてから古いトークンが通らなくなるまで、最大で約 10 分かかる
- authorizer Function の入出力(OCI の公式ドキュメント「Creating an Authorizer Function」で確認。https://docs.oracle.com/en-us/iaas/Content/APIGateway/Tasks/apigatewayusingauthorizerfunction_topic-Creating_an_Authorizer_Function.htm)
  - **複数引数の authorizer Function** にする(単一引数は廃止予定とドキュメントにあるため)**(仮置き)**
  - API Gateway のデプロイメントの `parameters` で、引数 `authorization` に `request.headers[Authorization]` を渡す **(仮置き)**。Function には `{ "type": "USER_DEFINED", "data": { "authorization": "Bearer ..." } }` が届く
    - 元のリクエストにヘッダーがなければ、引数は `data` に入らない。同じヘッダーが複数あると配列で届く
  - 応答はどちらも HTTP 200 で返す
    - 成功: `{ "active": true, "expiresAt": "<5 分後の ISO 8601>" }`。API Gateway は `expiresAt` までの時間(60 秒〜1 時間の範囲)だけ結果をキャッシュする。これで「API Gateway 側のキャッシュ 5 分」を実現する **(仮置き)**
    - 失敗: `{ "active": false, "wwwAuthenticate": "Bearer" }`。API Gateway はクライアントに `401` と `WWW-Authenticate: Bearer` を返す **(仮置き)**
    - `scope` は返さない(認可のポリシーに `ANY_OF` を使わないため)。`context` も返さない。ドキュメントの応答に `principal` という項目はないので使わない
    - Function が 5xx を返すと、API Gateway はクライアントに `502` を返す(ボディは無視される)
  - 次は Vault を読まずに `active: false` を返す **(仮置き)**: `type` が `USER_DEFINED` でない、`authorization` がない、配列で届いた(要素が 1 つでも)、Bearer の形でない
  - Bearer の解釈 **(仮置き)**: 前後の空白を除き、スキーム名は大文字・小文字を区別せず、スキームのあとに 1 つ以上の空白、トークンは RFC 6750 の b64token の文字だけ
  - 比較: 両方を SHA-256 にしてから `crypto.timingSafeEqual` で比べる **(仮置き)**。`timingSafeEqual` は長さが同じでないと比べられないため。これで長さの違いも時間に出ない
  - Vault から読めない(権限・ネットワークなど)ときは、例外を投げる(API Gateway は `502`)**(仮置き)**。`401` にすると設定の誤りがトークンの誤りに見えるため。失敗はキャッシュしない。取得中に重ねて呼ばれたら、同じ取得を待つ
  - シークレットの値がトークンの形式(base64url で 43 文字以上 = 32 バイト以上)でなければ、設定の誤りとして例外を投げる(`502`)**(仮置き)**。前後の空白や改行は取り除かない(登録のときの誤りに気づけるように)。例外のメッセージとログにシークレットの値を含めない
  - シークレットの値は、Vault の現在のバージョン(`CURRENT`)を base64 から UTF-8 に戻したもの。SDK の `SecretsClient` はリソースプリンシパルで認証し、リージョンもリソースプリンシパルのものを使う。最初に Vault を読むときに作る **(仮置き)**
- 注意: Vault の削除は即時ではなく、猶予期間 7〜30 日(既定 30 日)を経てから消える。Terraform では最短の 7 日を指定する **(仮置き)**。`terraform destroy` の直後に同じ名前で作り直すと失敗しうる。infra/README.md に追記すること
  - 指定の方法 **(仮置き)**: Vault と鍵の `time_of_deletion` を変数 `vault_time_of_deletion`(既定 `null` = OCI の既定の 30 日)で渡す。destroy の前に、人が 7 日より少し先の日時を入れて apply してから destroy する(infra/README.md)。この値が destroy で使われるかは未確定([13 章](#13-未確定事項要検証) の 9)

## 8. CORS

- フロントエンドは API と同じオリジンから配信するので、**本番運用では CORS は使わない**
- stg だけ、手元の開発サーバー(例: `http://localhost:5173`)からの呼び出しを許可する
- 許可するオリジンは、Terraform の変数 `cors_allowed_origins`(`list(string)`)で環境ごとに渡す
  - 値は Git 管理外の `terraform.tfvars` に書き、`terraform.tfvars.example` にはプレースホルダを置く
  - prod は空のリスト。空なら CORS のポリシー自体を設定しない
  - `*` は使わない
- 設定値
  - 許可するヘッダー: `Authorization`, `Content-Type`, `If-Match`
  - 許可するメソッド: `GET`, `POST`, `PATCH`, `DELETE`
  - 外部に公開するヘッダー(`Access-Control-Expose-Headers`): `ETag`, `Location`, `Retry-After`(ETag を公開しないと、ブラウザの JS から読めない)
  - Cookie は使わないので、`Access-Control-Allow-Credentials` は付けない
- authorizer が 401 を返したときの応答に CORS ヘッダーが付くかは未確定([13 章](#13-未確定事項要検証) の 3)

## 9. バックエンドの設計

### 9.1 層の分け方

```
[API Gateway] → アダプター層(apps/api/memo-api)
                  - FDK の入力(メソッド・パス・ヘッダー・ボディ)を解釈してルーティングする
                  - ユースケースを呼ぶ
                  - ドメインの結果を HTTP(ステータス・ヘッダー・problem+json)に変換する
                  - ETag ⇔ バージョン文字列の変換(ダブルクォートの付け外し)
             → ユースケース(packages/core)
                  - createMemo / listMemos / getMemo / updateMemo / deleteMemo
                  - バリデーション、ID と時刻の生成、404 / 412 の判定
             → ポート(packages/core に置くインターフェース)
                  - MemoRepository, Clock, IdGenerator
             → リポジトリ実装(apps/api/memo-api。NoSQL の Node.js SDK を使う)
```

- ユースケースは HTTP も NoSQL も知らない
- アダプター層は FDK に依存しない純粋な関数(`createHandler(deps)` が返す `(request) => Promise<response>`)として書き、FDK との接続は薄い別ファイルにする **(仮置き)**
  - 入力: リクエスト ID・メソッド・URL(パスとクエリ文字列)・ヘッダー・ボディ(文字列)。出力: ステータス・ヘッダー・ボディ(文字列)
  - ログの出力先と所要時間の計測用のタイマーも `deps` で受け取る(Node.js の API に直接依存しない)
  - FDK との接続は `apps/api/memo-api/src/fdk/fdk-bridge.ts`、エントリポイントは `src/func.ts`。実行環境では、ログは `console.log`、タイマーは `performance.now()` を使う(`durationMs` に小数が付く)**(仮置き)**
- FDK との接続 **(仮置き)**
  - `@fnproject/fdk` の `handle` に `inputMode: "string"` で渡し、ボディを文字列のまま受け取る
  - FDK は、API Gateway のリクエストを `Fn-Http-Method` / `Fn-Http-Request-Url` / `Fn-Http-H-<名前>` のヘッダーで受け取る。`ctx.httpGateway` の `method` / `requestURL` をそのままアダプター層の入力にする。ヘッダーの値は配列のまま渡す(複数行の `If-Match` をアダプター層で判定するため)
  - ヘッダーは `ctx.httpGateway.headers`(`Fn-Http-H-` 付きで届いたもの)だけを使う。呼び出しそのもののヘッダー(`ctx.headers`)には、API Gateway が Function を呼ぶときのヘッダー(`Host`・`Date`・`User-Agent`・`Oci-Subject-*`・`X-Content-Sha256` など)が入るため使わない(2026-09-29 に stg のログで確認。[13 章](#13-未確定事項要検証) の 16)
    - 同じ名前にまったく同じ値が重なって届いたら、1 つにまとめる **(仮置き)**。stg では、クライアントが 1 つだけ送った `Content-Type: application/json` が `Fn-Http-H-Content-Type` の同じ値 2 つとして届き、複数行とみなして `415` にしていた。値の違う複数行はそのまま渡す(`Content-Type` なら `415`)
  - `requestURL` が `/` で始まらない(スキームとホスト付き)ときは、パスとクエリ文字列だけにする。OCI の API Gateway でどちらの形で届くかは未確認([13 章](#13-未確定事項要検証) の 6)
  - メソッド・URL・呼び出し ID のどれかがない(HTTP Gateway 経由でない)呼び出しは、例外を投げる(FDK が 502 を返す)
  - レスポンスは `ctx.httpGateway.statusCode` と `setResponseHeader` で返す。`Content-Type` は FDK の応答の Content-Type になる
  - ボディは FDK の `rawResult` で包んで返す。FDK(`@fnproject/fdk` 0.0.108 の `fn-fdk.js` の `sendResult`)は、ハンドラーが文字列を返し、応答の Content-Type が `application/json` か `+json` を含むと、その文字列をもう一度 `JSON.stringify` してから書き出す。そのまま返すと、ボディが JSON の文字列リテラル(`"{\"id\":...}"`)になり、`204` にも `""` の 2 バイトが付く。`rawResult` の結果は `writeResult` でそのまま書き出される
  - FDK は応答に必ず `Content-Type` を付ける(指定しなければ `application/json`)。このため `204` にも `Content-Type: application/json` が付く。API Gateway を通すと、クライアントには付かずに届く(2026-09-29 に stg で確認。[13 章](#13-未確定事項要検証) の 7)
- 本番用の IdGenerator と Clock **(仮置き)**
  - IdGenerator は `apps/api/memo-api/src/ulid-generator.ts` の `MonotonicUlidGenerator`(乱数は `crypto.randomBytes`)。core には置かない(サーバーだけが使うため)
  - 同じミリ秒に続けて作るときは、乱数部分(80 ビット)に 1 を足す。上限を超えたら例外を投げる(`500`)
  - 時刻が前の呼び出しより戻ったときは、渡された時刻で乱数を引き直す(ULID の時刻部分と `createdAt` を同じ時刻にするため)。このときの順序は保証しない
  - Clock は `new Date()`
- エラーは例外ではなく、型付きの判別共用体(`{ ok: true, value } | { ok: false, error }`)で返す **(仮置き)**
- リポジトリは NoSQL のスロットリングを、ドメインの `Throttled` エラーに変換して返す
  - 判別共用体で返すのはスロットリングだけ。それ以外の失敗(接続エラーなど想定外のもの)は例外のまま投げ、アダプター層で捕まえて `500`(`INTERNAL`)にする **(仮置き)**
- `MemoRepository` の操作 **(仮置き)**
  - `insert(memo)` → version
  - `findById(id)` → memo と version、またはなし
  - `list({ after?, limit })` → 要約の配列(`limit + 1` 件まで取得)
    - リポジトリは `limit + 1` 件までをそのまま返し、ユースケースが先頭の `limit` 件に切り詰めて、`limit + 1` 件目の有無から `nextCursor` を決める **(仮置き)**
  - `updateIfVersion(memo, expectedVersion)` → 新しい version、または競合
  - `delete(id, expectedVersion?)` → 成功 / なし / 競合

### 9.2 実行時の設定

- NoSQL への認証: **リソースプリンシパル**(Function 自身の ID で認証する方式)。API キーは Function に置かない
- NoSQL クライアントはモジュールのスコープで 1 回だけ作り、以降の呼び出しでも使い回す
  - 作るのは最初の呼び出しのとき **(仮置き)**。NoSQL の SDK はクライアントを作る時点でリソースプリンシパルの環境変数を読み、なければ例外を投げる。モジュールの読み込み時に作ると、Functions の外(手元のコンテナ)でエントリポイントを読み込めないため。作るのに失敗したら保持せず、次の呼び出しで作り直す
- 1 件の取得(`findById`。詳細の `GET` と、`PATCH` の前の読み込みで使う)は、読み取りの一貫性を `ABSOLUTE` にする **(仮置き)**。既定の `EVENTUAL` で読んだバージョン(ETag)が、`putIfVersion` / `deleteIfVersion` の照合に通らないことが stg であったため([13 章](#13-未確定事項要検証) の 17)。`ABSOLUTE` の読み取りは `EVENTUAL` の 2 倍の読み取りユニットを使う(SDK の型定義 `Consistency` の説明)。一覧は `EVENTUAL` のまま(一覧は ETag を返さないため)
- SDK の自動リトライは**合計 5 秒で打ち切る**。打ち切ったら `429` + `Retry-After`
  - SDK の `timeout`(リトライとその待ち時間を含めた累積)に 5 秒を使う。クライアントの設定と、リポジトリの各操作のオプションの両方で渡す(クライアントを差し替えても打ち切り時間が変わらないように)**(仮置き)**
  - 5 秒は SDK の呼び出し 1 回ごと **(仮置き)**。一覧では文の準備(`prepare`)と、結果が複数回に分かれて返ったときの各回がそれぞれ 5 秒になり、合計は 5 秒を超えうる
  - スロットリングとして扱うのは `READ_LIMIT_EXCEEDED` と `WRITE_LIMIT_EXCEEDED`、およびそれが原因で打ち切り時間に達した `NoSQLTimeoutError`(`cause` がスロットリング)**(仮置き)**。原因がスロットリングでない打ち切り(ネットワークエラーなど)と、DDL などの `OPERATION_LIMIT_EXCEEDED` は想定外の失敗(`500`)にする
  - SDK の既定のリトライ回数の上限(10 回)と待ち時間(200ms からの指数バックオフ)は変えない **(仮置き)**。先に回数の上限に達したときは、スロットリングのエラーがそのまま届くので、同じく `Throttled` にする
- リポジトリの実装 **(仮置き)**
  - NoSQL クライアントはコンストラクタで受け取る(テストでは偽物か KVLite 用のクライアントを渡す)。本番用の設定は `cloudNoSqlConfig({ compartment })`(リソースプリンシパル。リージョンはリソースプリンシパルのものを使うので指定しない)で作る
  - 一覧の文は `prepare` し、リポジトリのインスタンスの中で使い回す。呼び出しごとに `copyStatement()` で複製してから値を入れる
  - 条件付き削除は `deleteIfVersion` に `returnExisting: true` を付け、失敗したときに既存の行のバージョンが返れば `conflict`、返らなければ `not_found` とする
  - テーブル名は文に埋め込むので、`^[A-Za-z][A-Za-z0-9_]*$` に合わない名前はコンストラクタで拒否する
  - `insert` で id が重複したら(`putIfAbsent` の失敗)例外を投げる(`500`)。インメモリの偽物と同じ
- Function の設定: memo-api・authorizer ともに、タイムアウト 30 秒、メモリ 256MB
- テーブル名やコンパートメントは、Function の設定(環境変数)で渡す
  - 名前 **(仮置き)**: memo-api は `NOSQL_TABLE_NAME`・`NOSQL_COMPARTMENT_ID`、authorizer は `AUTH_TOKEN_SECRET_ID`(シークレットの OCID)。値は Terraform で設定する
  - 足りない(未設定・空)ときは、モジュールの読み込みの時点で、足りない名前を挙げて例外を投げる **(仮置き)**
- IAM(Terraform で作る)
  - 動的グループ: 対象コンパートメントの Functions
  - memo-api: 対象テーブルの行の読み書き
  - authorizer: 対象シークレットの読み取り
  - API Gateway: 対象 Functions の呼び出し
  - 権限は必要最小限にする
  - 書き方は [9.6](#96-インフラterraform仮置き) の IAM を参照

### 9.3 テスト方針

- **テストを先に書く**対象
  - `packages/core` のユースケースとバリデーション。リポジトリ・Clock・IdGenerator はインメモリの偽物を渡す
  - アダプター層の HTTP 変換(ルーティング、ステータス、ヘッダー、problem+json、4.4 の判定の順序)
  - フロントエンドの API クライアント層([10.4](#104-テスト)、[10.5](#105-api-クライアント層仮置き))
- **リポジトリの契約テスト**
  - 同じテストを、インメモリ実装と NoSQL 実装の両方に対して実行する
  - NoSQL 側は、ローカルの Docker で動かす Oracle NoSQL Database CE の KVLite(イメージ: `ghcr.io/oracle/nosql:latest-ce`)を使う
    - arm64 版のイメージがあり、Apple Silicon の Mac(Colima)で動作確認済み([13.1](#131-確認済み事項))
  - 最低限確認すること:
    - `ORDER BY id DESC` の順序
    - `after` と `limit + 1` による境界(ちょうど `limit` 件、0 件、最後のページ)
    - 書き込むたびに行バージョンが変わること
    - バージョンが一致しないときの条件付き書き込み・削除の失敗
    - 存在しない id
  - インメモリの偽物は、行バージョンを「書き込むたびに変わる opaque な文字列」として再現する
  - 実行コマンドを分ける **(仮置き)**: `npm test` は Docker 不要のテストだけ、`npm run test:contract` は KVLite を使う
    - KVLite を使うテストのファイル名は `*.contract.test.ts` にする。`npm test` はこれを除外する **(仮置き)**
    - KVLite の起動と停止は `npm run kvlite:up` / `npm run kvlite:down`(コンテナ名 `memo-kvlite`、ポート 8080)**(仮置き)**。接続先は環境変数 `KVLITE_ENDPOINT` で変えられる(既定 `http://localhost:8080`)
    - テスト用のテーブル `memos_contract_test` を KVLite に作り、テストごとに `DELETE FROM` で空にする **(仮置き)**。DDL は `apps/api/memo-api/src/nosql/memos-table.ts` に置き、`infra/modules/nosql/main.tf` の DDL と列・型・主キーが同じことを `npm test` で確かめる
  - SDK をまねた偽物のクライアントを使うテスト(バージョンの変換、打ち切り時間、スロットリングの変換、一覧の文)は、Docker 不要のテストとして `npm test` で実行する **(仮置き)**。スロットリングは KVLite では起こせないため
- authorizer: 照合ロジック(ヘッダーの解釈、比較、キャッシュ)を関数として切り出してテストする。Vault からの取得は差し替えられるようにする
  - ファイルの分け方 **(仮置き)**: `bearer.ts`(ヘッダーの解釈と比較)、`secret-cache.ts`(キャッシュ。時刻を差し替えられる)、`vault-secret.ts`(Vault からの取得。`SecretsClient` の `getSecretBundle` だけを使い、テストでは偽物を渡す)、`authorize.ts`(入出力の変換と照合の流れ。トークンの取得を差し替えられる)、`func.ts`(FDK との接続)

### 9.4 ログ

- 1 リクエスト 1 行の JSON を標準出力に書き、OCI Logging に集める
- 出す項目: リクエスト ID、メソッド、ルートのテンプレート(例: `/api/memos/{id}`)、ステータス、所要時間(ms)、エラー時の `code`
  - キー名 **(仮置き)**: `requestId` / `method` / `route` / `status` / `durationMs` / `code`(エラー時だけ) / `error`(`500` のときだけ。`name`・`message`・`stack`)
  - 定義していないルートでは `route` を `null` にする(実際のパスは出さない)**(仮置き)**
  - リクエスト ID は FDK の呼び出し ID(`Fn-Call-Id`、`ctx.callID`)を使う **(仮置き)**。呼び出しごとに必ずあり、OCI Functions のログの呼び出しとも対応するため。API Gateway の `opc-request-id` と突き合わせられるかは未確認([13 章](#13-未確定事項要検証) の 8)
- **出さないもの: `title`、`body`、トークン、`Authorization` ヘッダー**
- `500` のときは、原因の例外をログに出す(レスポンスには出さない)

### 9.5 Functions のイメージ(仮置き)

- Functions のアプリケーションのシェイプは `GENERIC_ARM`(決定)。イメージは Apple Silicon の Mac で `linux/arm64` としてネイティブにビルドする
- npm workspaces のままでは `fn build` が `@memo/core` を解決できないので、esbuild で Function ごとに 1 ファイル(`dist/func.cjs`)にまとめ、独自の Dockerfile でイメージに入れる(決定)
  - ベースイメージは OCI Functions の公式 Node FDK のランタイムイメージ `fnproject/node:24`。イメージには `func.cjs` だけを入れ、`node_modules` は入れない(`.dockerignore` で `dist/func.cjs` 以外を除く)
  - 出力は CommonJS(FDK・OCI SDK・NoSQL SDK が CommonJS のため)。バンドルは `scripts/bundle-function.mjs` で行い、esbuild の警告が 1 つでもあれば失敗にする
  - oracle-nosqldb の `lib/constants.js` にある `delete require.cache[require.resolve('../package.json')]` は、1 ファイルにまとめると実行時に `package.json` を解決できず、読み込みで例外になる。キャッシュを消すだけの行なので、バンドルのときに取り除く。該当の行が見つからなければ(SDK の更新で変わったら)ビルドを失敗させる
- コマンド: `npm run build:functions`(各 Function の `npm run build:function` = `npm run bundle` + `docker build --platform linux/arm64`)
  - イメージ名は `memo-api:local` と `memo-authorizer:local`。namespace などの環境固有の値は入れない。push するときは、人がリポジトリの名前とタグを付け直す
- `func.yaml` は `runtime: docker`・メモリ 256MB・タイムアウト 30 秒。`fn build` はバンドルを実行しないので、イメージは `npm run build:functions` で作る。シェイプと Function の設定は Terraform で設定する
- 手元での確認: `scripts/fdk-smoke.cjs` をコンテナに渡し、エントリポイントを FDK の `http-stream` 形式で起動して 1 回呼び出す(OCI には接続しない)。リソースプリンシパルがないので、NoSQL と Vault を使う呼び出しは `502` になる

### 9.6 インフラ(Terraform)(仮置き)

第6回で `infra/` に追加したものの決め事。手順は `infra/README.md`。印のないものも、この節はすべて **(仮置き)**。

- モジュールの分け方: `modules/web_bucket`(バケット・PAR)、`modules/vault`(Vault・鍵)、`modules/functions`(OCIR のリポジトリ・アプリケーション・Function・呼び出しログ)、`modules/iam`(動的グループ・ポリシー)、`modules/api_gateway`(ゲートウェイ・デプロイメント・アクセスログと実行ログ)。ロググループは `envs/stg` に 1 つ置き、各モジュールに渡す
- **2 段階の apply**(決定): `memo_api_image`・`authorizer_image`・`auth_token_secret_id` の 3 つがそろったときだけ、Function・API Gateway のデプロイメント・デプロイメントのログ・シークレットの読み取りのポリシー文を作る
  - 一部だけ入れたときは、黙って 1 回目の状態のままにせず、plan を失敗させる(`envs/stg` の namespace のデータソースの precondition)
  - API Gateway のゲートウェイ本体は Function に依存しないので 1 回目で作る(ホスト名を先に決め、`cors_allowed_origins` や `apps/web/.env` を準備できるようにするため)
- 変数(`envs/stg`)
  - 追加: `tenancy_ocid`(動的グループを作る場所。namespace の取得にも使う)、`web_par_expires_at`(RFC 3339)、`cors_allowed_origins`(`*` を拒否する)、`log_retention_days`(既定 30。30 日単位で 180 日まで)、`vault_time_of_deletion`(既定 `null`)、`memo_api_image`・`authorizer_image`・`auth_token_secret_id`(既定 `null`)
  - Object Storage の namespace は tfvars で渡さず、データソース `oci_objectstorage_namespace` で引く(値をファイルに書かずに済むため)
- 名前: リソースの表示名は `<project>-<env>-...`。バケットは `<project>-<env>-web`、OCIR のリポジトリは `<project>-<env>/memo-api` と `<project>-<env>/authorizer`(環境ごとに分ける。prod には stg で確かめたイメージを同じダイジェストのまま付け直して push する)、Function の表示名は `func.yaml` の `name` と同じ `memo-api` と `authorizer`
- OCIR のリポジトリ: 非公開(`is_public = false`)。タグの上書きは禁止しない(`is_immutable` は既定の `false`)
- Function: イメージは `source_details`(`CONTAINER_IMAGE`)で渡す(`image` 属性はプロバイダで非推奨のため)
- Vault の鍵: HSM 保護の AES 256 ビット。シークレットの暗号化にソフトウェア保護の鍵を使えるかは未確認で、HSM 保護でも費用は無料枠内のため([13.1](#131-確認済み事項))
- シークレット: 名前は `<project>-<env>-auth-token`。人が OCI CLI の `oci vault secret create-base64` で作る。トークンは権限 600 の一時ファイルに作り、`--secret-content-content file://...` で渡す(値を画面・シェルの履歴・コマンドラインの引数に出さないため)
- 画面の配信
  - PAR は `AnyObjectRead`・`bucket_listing_action = Deny`。URL(`full_path`)はモジュールの出力で `sensitive` にし、デプロイメントにも sensitive のまま渡す(plan の表示に出さない)。ルートの output `web_par_base_url` も sensitive
  - `/` は `<PAR の URL>index.html`、`/{path*}` は `<PAR の URL>${request.path[path]}`。どちらも `GET` だけ
- API Gateway のデプロイメント
  - パスの接頭辞は `/`。デプロイメントの `authentication` に authorizer(`CUSTOM_AUTHENTICATION`、`parameters = { authorization = "request.headers[Authorization]" }`、`cache_key = ["authorization"]`)を置き、`is_anonymous_access_allowed = true` にする。`/api` のルートは `AUTHENTICATION_ONLY`、画面のルートは `ANONYMOUS`
  - `/api/memos` は `GET`・`POST`、`/api/memos/{id}` は `GET`・`PATCH`・`DELETE`
  - CORS は `cors_allowed_origins` が空でなければ、デプロイメントの `request_policies.cors` に 8 章の値で設定する。`is_allow_credentials_enabled = false`
  - 実行ログのレベルは `INFO`
- IAM
  - 動的グループ: `ALL {resource.type = 'fnfunc', resource.compartment.id = '<stg コンパートメント>'}`。`oci_identity_dynamic_group` でテナンシに作る
  - ポリシーでは動的グループを `dynamic-group id <OCID>` で書く。Identity Domains のテナンシでは、名前で書くとドメイン名(`'<ドメイン>'/'<名前>'`。省略すると Default)が関わるため。`oci_identity_dynamic_group` で作った動的グループが Default ドメインに入るかは未確定([13 章](#13-未確定事項要検証) の 12)
  - 動的グループはコンパートメントの Functions 全体なので、**memo-api と authorizer は同じ権限を持つ**(関数ごとには分けない)。代わりに条件で対象を絞る
  - ポリシーの文(stg コンパートメントに付ける)
    - `Allow dynamic-group id <DG> to manage nosql-rows in compartment id <C> where target.nosql-table.name = '<テーブル>'`(削除に `NOSQL_ROWS_DELETE` が要るので `manage`)
    - `Allow dynamic-group id <DG> to read secret-bundles in compartment id <C> where target.secret.id = '<シークレット>'`(2 回目の apply から)
    - `Allow any-user to use functions-family in compartment id <C> where ALL {request.principal.type = 'ApiGateway', request.resource.compartment.id = '<C>'}`
  - OCIR からイメージを取得するためのポリシーは作らない。Functions のポリシーのドキュメントに、同じテナンシのリポジトリから取得するための `service faas` の文がないため(署名の検証を使うときの鍵の読み取りだけ)
  - API Gateway のモジュールは IAM のモジュールに `depends_on` し、呼び出しの権限ができてからデプロイメントを作る
- ログ: ロググループ `<project>-<env>-logs` に、Function の呼び出しログ(`functions` / `invoke`、アプリケーション単位)と、API Gateway のアクセスログ・実行ログ(`apigateway` / `access`・`execution`、デプロイメント単位)を置く。保持期間は `log_retention_days`
- 参照した公式ドキュメント
  - 動的グループのルール: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionsaccessingociresources.htm
  - ポリシーの主体の書き方(Identity Domains): https://docs.oracle.com/en-us/iaas/Content/Identity/policysyntax/subject.htm
  - 動的グループのリソース(テナンシに作る): https://docs.oracle.com/en-us/iaas/tools/terraform-provider-oci/latest/docs/r/identity_dynamic_group.html
  - NoSQL のポリシー: https://docs.oracle.com/en-us/iaas/nosql-database/doc/policy-reference.html
  - Vault のポリシー: https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/keypolicyreference.htm
  - API Gateway から Functions を呼び出すポリシー: https://docs.oracle.com/iaas/Content/APIGateway/Tasks/apigatewaycreatingpolicies.htm#dynamicgrouppolicy
  - Functions のポリシー: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionscreatingpolicies.htm
  - Vault の削除: https://docs.oracle.com/en-us/iaas/Content/KeyManagement/Tasks/managingvaults_topic-To_delete_a_vault.htm
  - ログの種類: https://docs.oracle.com/en-us/iaas/Content/Logging/Reference/details_for_functions.htm 、https://docs.oracle.com/en-us/iaas/Content/Logging/Reference/details_for_api_gateway.htm
  - API Gateway のログのポリシー: https://docs.oracle.com/en-us/iaas/Content/APIGateway/Tasks/apigatewayaddinglogpolicies.htm

## 10. フロントエンド

### 10.1 技術と配信

- Vite + TypeScript。フレームワークは使わない
- ビルド成果物(`apps/web/dist`)を Object Storage のバケットに置く。API Gateway の HTTP バックエンドから、事前認証済みリクエスト(PAR)経由で配信する
  - バケットは非公開。PAR は読み取り専用、オブジェクトの一覧は不可 **(仮置き)**
  - PAR には有効期限が必須。期限切れで配信が止まるので、期限は変数で渡す。README に更新手順を書く **(仮置き)**
  - PAR の URL は環境固有の値なので、コミットしない(Terraform 内で API Gateway の設定に渡すだけにする)
  - `/` は `index.html` を返す。それ以外は `/{path*}` を同じ名前のオブジェクトに対応させる。これで動くかは未確定([13 章](#13-未確定事項要検証) の 4)
- 画面の切り替えはハッシュルーティング(`#/memos/{id}` など)にする **(仮置き)**。Object Storage の配信では、存在しないパスを `index.html` に振り替えられないため
- API のベース URL
  - 本番のビルドでは相対パス `/api` を使う
  - 手元で開発するときは `VITE_API_BASE_URL` を `apps/web/.env`(Git 管理外)で渡し、`apps/web/.env.example` にプレースホルダを置く
  - `VITE_API_BASE_URL` の値は `/api` まで含める(例: `https://<host>/api`)。末尾の `/` は取り除く **(仮置き)**
  - 本番のビルドでは `VITE_API_BASE_URL` があっても使わない(`.env` は本番のビルドでも読み込まれるため)。開発で値がない・空のときは、黙って `/api` にせず例外を投げる **(仮置き)**
- ルートの `npm run build` で各ワークスペースの `build`(今は `apps/web` の `vite build` だけ)を実行する **(仮置き)**
- ルート **(仮置き)**: `#/`(空・`#` も)は一覧、`#/memos/new` は新規作成、`#/memos/{id}` は詳細 / 編集。id はパーセントエンコードを戻してから ULID の形式で判定し、形式が違えば API を呼ばずに「ページが見つかりません」を出す。末尾の `/` など、それ以外はすべて見つからない扱い
- ファイルの分け方 **(仮置き)**: `src/ui/` に画面から切り出した純粋なロジック(ルート、入力の上限、Retry-After の時間、文言、トークンの保管)、`src/screens/` と `src/app.ts` に DOM を操作する部分。要素は `src/ui/dom.ts` の `h()` で作り、文字列は必ずテキストノードとして入れる(`innerHTML` を型で受け付けない)

### 10.2 画面

- トークン入力
- 一覧
- 詳細 / 編集
- 新規作成
- 削除(確認ダイアログを出す)

### 10.3 振る舞い

- **トークン**
  - 起動時に `sessionStorage` にトークンがなければ、入力画面を出す
  - ビルド成果物にトークンを埋め込まない
  - `401` が返ったらトークンを破棄し、入力画面に戻す
  - 既知のリスク: XSS があるとトークンが漏れる。対策として、ユーザー入力(title / body)は `textContent` で表示し、`innerHTML` は使わない
- **一覧**
  - 新しい順に表示する
  - 「もっと見る」ボタンで `nextCursor` を使って次を読み込む。無限スクロールにはしない
  - `nextCursor` が `null` ならボタンを隠す
- **編集**
  - 詳細を GET して得た `ETag` を保持し、PATCH の `If-Match` に付ける
  - DELETE にも `If-Match` を付ける
- **`412`(他の場所で先に更新された)**
  - 入力中の内容は消さずに残したまま、「他で更新されています。最新を読み込みますか?」と表示する
  - 最新を読み込むと入力中の内容は失われるので、その前にコピーできるようにする
- **`429`**
  - 「混み合っています」と表示し、`Retry-After` の秒数が経つまで保存ボタンを無効にする
  - 自動では再送しない
- **入力の上限**
  - `packages/core` の定数を使い、画面でも事前にチェックする(API 側の検証は省略しない)
  - body は残りのバイト数を表示する
- **未保存のまま離れるとき**
  - 画面を離れるときや別の画面に移るときに、確認のダイアログを出す(`beforeunload` とハッシュの変更で判定する)
- 実装で決めたこと(すべて **(仮置き)**)
  - トークン
    - `sessionStorage` のキーは `memo.token`。入力の前後の空白は取り除く(貼り付けで付きやすいため)。空なら受け付けない
    - トークン入力はルートではなく、別の領域として持つ。`401` のときは入力中の画面を消さずに隠し、トークンを入れ直したら元の画面に戻す(入力中の内容を失わないため)。失敗した操作は自動で再送せず、もう一度押してもらう
  - 一覧は既定の件数(20 件)で読み、各行にタイトルと更新日時を出す。最初の読み込みに失敗したら、メッセージだけを出す(再読み込みで直す)
  - 作成・編集
    - 事前チェックは core の検証(`validateCreateMemoInput`)をそのまま使う。編集でも title は空にできない。問題があるあいだは保存ボタンを押せない
    - `input` の `maxlength` は付けない(UTF-16 の長さで数えるため、コードポイント数の上限と合わない)
    - 編集では、保存済みの内容から何も変わっていなければ保存ボタンを押せない。PATCH には変わったキーだけを入れる(`{}` は `400` になるので送らない)
    - 保存中に入力が続いても、成功したときに入力欄は書き換えない(保存済みの内容と ETag だけを更新する)
    - 作成できたら、応答のメモと ETag をそのまま使って詳細画面に移る(もう一度 GET しない)。履歴は置き換える(戻るボタンで空の作成画面に戻らない)
  - `412` は保存と削除のどちらでも同じ案内を出す。「入力内容をコピー」はタイトル・空行・本文をつなげてクリップボードに入れる。「最新を読み込む」で入力欄を最新の内容に置き換える
  - `429`
    - 保存(作成)ボタンに加えて、削除ボタンも同じ時間だけ無効にする。ボタンに残りの秒数を出す
    - `Retry-After` がない(または秒数として読めない)ときは 5 秒待つ
  - 削除で `404` が返ったら、すでに消えているので、削除できたときと同じく一覧に戻る
  - 離れるときの確認: ハッシュの変更で確認し、キャンセルされたら `history.replaceState` で URL を元に戻す(`hashchange` を起こさない)。`beforeunload` は `preventDefault()` で確認を出す
  - fetch 自体の失敗(ネットワーク、CORS、`ETag` が読めない)は、画面に「通信に失敗しました」と出し、詳細はコンソールに出す

### 10.4 テスト

- **テストを先に書く**のは API クライアント層(fetch を包む部分)だけ
  - ETag の保持と `If-Match` の付与
  - problem+json から `code` への変換(401 のボディが problem+json でない場合も含む)
  - `Retry-After` の解釈
  - カーソルの受け渡し
- UI は自動テストせず、手動の確認手順(チェックリスト)で確認する。チェックリストは `apps/web/README.md` に書く
- API クライアントのテストは偽物の fetch を使う。加えて、偽物の fetch の裏に memo-api のアダプター(`createHandler` + インメモリのリポジトリ)を置き、クライアントとサーバーの組み合わせで CRUD・`412`・カーソルでのページ送りを確かめる(`apps/web/src/api/client.adapter.test.ts`。Docker 不要なので `npm test` で実行する)**(仮置き)**
  - このため memo-api は `@memo/memo-api/handler`(`createHandler` だけ。NoSQL の SDK を読み込まない)をサブパスとして公開し、`apps/web` は memo-api を `devDependencies` にだけ入れる **(仮置き)**
- 画面から切り出せる純粋なロジック(`src/ui/` のルートの解釈、残りバイト数、PATCH の組み立て、Retry-After による待ち時間、文言、トークンの保管)も、テストを先に書く **(仮置き)**。DOM を操作する部分(`src/screens/`、`src/app.ts`)は自動テストしない
- 手元で画面を確かめるための API サーバー **(仮置き)**
  - `npm run dev:api -w @memo/web` で、memo-api のアダプター(`createHandler`)+ インメモリのリポジトリを `http://127.0.0.1:8787` で動かす(`apps/web/scripts/local-api.ts`)。workspaces のパッケージを読むため、esbuild で 1 ファイルにまとめてから node で実行する
  - 開発サーバーは `/api` をこのサーバーに中継する(`apps/web/vite.config.ts`)。`apps/web/.env` を `VITE_API_BASE_URL=/api` にしたときに使われる。ポートは `LOCAL_API_PORT` で変えられる
  - 認証は固定のトークン(既定 `local-dev-token`、`LOCAL_API_TOKEN` で変えられる)。違えば `401`(ボディは text/plain。API Gateway と同じく problem+json を保証しない)
  - `POST /__local/throttle?count=N` で、次の N 回のリポジトリの操作を `Throttled` にする(`429` を手で確かめるため)

### 10.5 API クライアント層(仮置き)

`apps/web/src/api/client.ts` の `createApiClient({ baseUrl, getToken, fetch? })`。画面の状態は持たない。以下はすべて **(仮置き)**。

- **戻り値**: core の `Result` を使い、`{ ok: true, value }` か `{ ok: false, error: ApiError }` を返す
  - `ApiError` は `{ status, code, errors?, retryAfterSeconds? }`。`code` は core の `ErrorCode`
  - fetch 自体の失敗(ネットワークエラー、CORS で拒否されたときなど)は例外のまま投げる
  - 成功のレスポンスに `ETag` がない(CORS で公開していないなど)のは設定の誤りなので、例外を投げる
- **メモの型**: core の `Memo` / `MemoSummary` / `MemoPage` を使い、`createdAt` / `updatedAt` は `Date` に変換する
- **ETag**: 作成・取得・更新はメモと ETag(ダブルクォート付きのヘッダーの値のまま)を `{ memo, etag }` で返す。ETag はクライアントの中にはためず、呼び出し側(画面)が持ち、`updateMemo(id, etag, patch)` / `deleteMemo(id, etag?)` に渡す。渡した値をそのまま `If-Match` に付ける。`deleteMemo` で省略したら `If-Match` を付けない
- **エラーの変換**
  - `401` はボディにかかわらず `UNAUTHORIZED`(ボディを読まない)
  - それ以外は、`Content-Type` のメディアタイプが `application/problem+json` で、`code` が `ERROR_CODES` のどれかならそれを使う。`VALIDATION_FAILED` なら `errors` も返す
  - problem+json でない、または知らない `code` のときは、ステータスから決める: `404` → `NOT_FOUND`、`412` → `PRECONDITION_FAILED`、`415` → `UNSUPPORTED_MEDIA_TYPE`、`428` → `PRECONDITION_REQUIRED`、`429` → `THROTTLED`、それ以外(`502` など)→ `INTERNAL`
- **Retry-After**: 前後の空白を除いて 0 以上の整数(秒数)として読めたときだけ `retryAfterSeconds` を付ける。HTTP-date・小数・負の数などは付けない(API は秒数で返すため)。付かなかったときにどれだけ待つかは画面で決める
- **カーソル**: `listMemos({ cursor?, limit? })`。受け取った `nextCursor` を解釈せずに `cursor` クエリとして渡す。`nextCursor` はそのまま(最後のページでは `null`)返す
- **トークン**: `getToken()` をリクエストのたびに呼び、`Authorization: Bearer <token>` を付ける。`sessionStorage` での保管は画面側で作る
- **パス**: `{baseUrl}/memos`、`{baseUrl}/memos/{id}`。id は `encodeURIComponent` でエンコードする
- **fetch**: 差し替えられる。省略時はグローバルの `fetch` を包んで呼ぶ(ブラウザでは `window` 以外を `this` にして呼ぶと失敗するため)

### 10.6 配置作業

- インフラ(バケット・PAR・API Gateway など)は Terraform で作る。**静的ファイルのアップロードは Terraform の外**で行う
- npm スクリプトを 2 つ用意する
  - `npm run deploy:web`: ビルド成果物をバケットと同期する(`oci os object sync` 相当)
    - Content-Type を拡張子から付ける
    - Cache-Control は、`index.html` を `no-cache`、ハッシュ付きのファイル(`assets/*`)を `public, max-age=31536000, immutable` にする
    - `assets/*` を先に上げ、`index.html` を最後に上げる(古い `index.html` が消えたファイルを参照する時間をなくすため)**(仮置き)**
    - バケットにあって `dist/` にないファイルは削除する **(仮置き)**
  - `npm run clean:web`: バケットを空にする。`terraform destroy` の前に実行する(OCI のバケットは空でないと削除できない)
- 環境固有の値(namespace、バケット名、OCI CLI のプロファイル、リージョン)は、Git 管理外の `.env` から読む。`.env.example` だけをコミットする
- **どちらのスクリプトも人が実行する**。Claude Code は実行しない
- Content-Type が正しく付くかは未確定([13 章](#13-未確定事項要検証) の 5)
- 実装で決めたこと(すべて **(仮置き)**)
  - `oci os object sync` は使わず、1 ファイルずつ `oci os object put --content-type ... --cache-control ... --force` で上げる(ファイルごとに Content-Type と Cache-Control を指定するため)。削除は `oci os object delete --force`、一覧は `oci os object list --all --fields name`
  - 順序: バケットの一覧を取得 → `assets/*` → その他のファイル → `index.html` → 一覧にあって `dist/` にないものを削除。各グループの中は名前順
  - Cache-Control: `assets/*` 以外(`index.html` と、`public/` から来るハッシュなしのファイル)は `no-cache`
  - Content-Type: `html`・`js`・`mjs`・`css`・`txt` は `charset=utf-8` を付ける。表にない拡張子(拡張子なしを含む)があれば、推測せずにアップロードを始める前に止める(`apps/web/scripts/deploy-plan.ts` の表に足す)
  - `npm run deploy:web` はビルド(`vite build`)してから同期する
  - `npm run clean:web` は `oci os object bulk-delete` を `--force` なしで実行し、OCI CLI の確認を人が答える
  - `.env` はリポジトリのルートに置く(`.env.example` もルート)。キーは `OCI_NAMESPACE` / `OCI_BUCKET` / `OCI_PROFILE` / `OCI_REGION`(OCI CLI 自身が読む `OCI_CLI_*` と名前を分ける)。スクリプトは `.env` を自分で読み、プロセスの環境変数には入れない。別の配置先は `--env-file <path>` で渡す。足りない値は、名前をすべて挙げて止める
  - `--dry-run`: 実行されるはずの oci コマンドを、シェルに貼れる形で表示するだけ。OCI に接続しないので、バケットの一覧を取らず、削除の対象は表示しない(削除のコマンドの形だけを出す)
  - スクリプトは TypeScript のまま `node` で直接実行する(型を取り除く機能を使う。Node.js 22.18 以降)。このため import に `.ts` を付け、型を消すだけで動く書き方に限る。型検査は `apps/web/tsconfig.node.json`(`@types/node` を使う)で行う。`apps/web/src` の tsconfig は変えない(DOM の型だけ)

## 11. 環境で変わってよい値

stg と prod で違ってよいのは、次の表の値だけ。**ここにないもの(API 仕様、コード、入力の上限、エラーの形式、リトライの打ち切り時間、Function のメモリとタイムアウト、NoSQL のユニット数など)は両環境で同一にする。**

| 値 | 渡し方 | 備考 |
|---|---|---|
| 親コンパートメントの OCID | `terraform.tfvars` | 既存 |
| 環境名(`stg` / `prod`)と、それを含むリソース名 | Terraform の変数 | 既存 |
| VCN とサブネットの CIDR | `terraform.tfvars` | 既存 |
| `cors_allowed_origins` | `terraform.tfvars` | stg は手元の開発サーバーのオリジン、prod は空 |
| 認証トークンの値 | Vault に人が登録する | 環境ごとに別の値 |
| 認証トークンのシークレットの OCID | `terraform.tfvars` | |
| ログの保持期間 | `terraform.tfvars` | |
| PAR の有効期限 | `terraform.tfvars` | |
| テナンシの OCID | `terraform.tfvars` | 動的グループを作る場所 **(仮置き)** |
| Function のイメージの参照(`memo_api_image` / `authorizer_image`) | `terraform.tfvars` | リポジトリが環境ごとに違うのでパスは変わる。ダイジェストは同じにする(下の注) **(仮置き)** |
| Vault と鍵の削除日時(`vault_time_of_deletion`) | `terraform.tfvars` | destroy の前にだけ入れる **(仮置き)** |
| namespace、バケット名、OCI CLI のプロファイル、リージョン | `.env`(配置スクリプト用) | |
| `VITE_API_BASE_URL` | `apps/web/.env` | 手元の開発のみ |

- コンテナイメージは一度だけビルドし、stg で確認したものと同じダイジェストを prod に使う
- NoSQL の読み取り・書き込みユニットは両環境で同じ値にする(変えるとスロットリングの振る舞いが変わり、stg での確認が prod の保証にならない)

## 12. 作業の分担

CLAUDE.md の方針どおり、クラウドに変更を加える操作は人が実行する。

| 操作 | 実行者 |
|---|---|
| `terraform plan` の実行と結果の提示、実行すべきコマンドの提示 | Claude Code でも可 |
| `terraform apply` / `terraform destroy` | 人 |
| Function のイメージのビルドと push | 人(ビルドとテストの準備は Claude Code でも可) |
| Vault へのトークンの登録・更新 | 人 |
| `npm run deploy:web` / `npm run clean:web` | 人 |

- 上の表の操作は、CLAUDE.md の「人が実行する」ルールに反映済み(Vault へのトークンの登録・更新、`npm run deploy:web` / `npm run clean:web` を含む)

## 13. 未確定事項(要検証)

| # | 事項 | 影響 | 結果が悪かったときの対応 |
|---|---|---|---|
| 1 | NoSQL の読み取りユニットが、選んだ列だけでなく行全体のサイズで消費されるか | 一覧で本文を返さないのに、読み取りコストが減らない可能性 | 読み取りユニットを増やす、または本文を別テーブルに分ける(テーブル変更を伴うので仕様を更新する) |
| 2 | 書き込み 1 ユニットのとき、16KB のメモを書き込むとスロットリングがどう振る舞うか | body の上限値、`429` の出やすさ | body の上限値を下げる、または書き込みユニットを増やす |
| 3 | authorizer が 401 を返したとき、その応答に CORS ヘッダーが付くか | stg で手元から開発するとき、401 が「CORS エラー」にしか見えない | 開発時の既知の制約として README に書く、または Vite の proxy で同一オリジンにする |
| 4 | API Gateway の HTTP バックエンドから PAR 経由で Object Storage に接続したとき、`/` を `index.html` として返せるか。Content-Type が保たれるか → **確認済み**([13.1](#131-確認済み事項)) | フロントエンドの配信方式 | ルートの定義を変える。だめなら配信方式を仕様から見直す |
| 5 | `oci os object sync` で Content-Type が正しく付くか。→ 配置スクリプトは拡張子ごとに `oci os object put --content-type --cache-control` で上げる形にした。手元の OCI CLI のバージョンで `--cache-control` が使えるか、付けた値が PAR と API Gateway を通して届くかは未確認 → **確認済み**([13.1](#131-確認済み事項)) | ブラウザで JS / CSS が読み込めない。キャッシュが効きすぎる・効かない | オプションが使えなければ OCI CLI を更新する。届かなければ API Gateway のレスポンスヘッダーの変換で付ける |
| 6 | API Gateway から Function に届く `Fn-Http-Request-Url` の形(パスとクエリ文字列だけか、スキームとホスト付きか。デプロイメントのパスの接頭辞を含むか) | ルーティングできず、すべて `404` になる | 届いた形に合わせて `fdk-bridge.ts` の変換を直す |
| 7 | memo-api の `204` に FDK が付ける `Content-Type: application/json` が、API Gateway を通してもクライアントに届くか → **確認済み**([13.1](#131-確認済み事項)) | ボディのない応答に Content-Type が付く(クライアントは 204 のボディを読まないので、動作への影響は小さい) | 既知の制約として残す、または API Gateway のレスポンスヘッダーの変換で消す |
| 8 | ログのリクエスト ID(`Fn-Call-Id`)と、API Gateway がクライアントに返す `opc-request-id` を突き合わせられるか | 画面で見たエラーから、ログをたどりにくい | `opc-request-id` もログに出す |
| 9 | Vault と鍵の `time_of_deletion` を apply で入れておくと、`terraform destroy` の削除の予約にその日時が使われるか(プロバイダのドキュメントには書式しか書かれていない) | 猶予期間が既定の 30 日になり、その間コンパートメントを消せない・作り直せない可能性 | destroy の前に OCI CLI(`oci kms management vault schedule-deletion --time-of-deletion`)で予約し、`terraform state rm` で state から外す手順に変える |
| 10 | 削除待ちの Vault と鍵(と、人が作ったシークレット)がコンパートメントにあるあいだに、コンパートメントを削除できるか。シークレットは Vault と一緒に消えるか | `terraform destroy` がコンパートメントの削除で失敗する | 猶予期間が過ぎてからもう一度 destroy する。常に困るなら、Vault をこのリポジトリ専用の親コンパートメントに置く |
| 11 | API Gateway のログの category の値の大文字・小文字(ドキュメントの表は `Access` / `Execution`。Terraform では `access` / `execution` と書いた) | 2 回目の apply でログの作成が失敗する | 失敗したら表の表記(`Access` / `Execution`)に変える。`oci logging service list` で確かめられる |
| 12 | Identity Domains のテナンシで、`oci_identity_dynamic_group`(従来の IAM API)で作った動的グループが Default ドメインに入り、ポリシー(`dynamic-group id <OCID>`)で使えるか | Function から NoSQL と Vault に接続できない(`502`) | `oci_identity_domains_dynamic_resource_group` で Identity Domain に作る形に変える(ドメインの URL を tfvars で渡す) |
| 13 | `is_anonymous_access_allowed = true` のとき、`Authorization` ヘッダーのない `/api` へのリクエストが(`AUTHENTICATION_ONLY` のルートで)`401` になるか | 認証なしで API に届く(memo-api は認証を見ないので、誰でも読み書きできる) | 画面と API を別のデプロイメントに分け、API のデプロイメントでは匿名のアクセスを許さない |
| 14 | デプロイメントのパスの接頭辞に `/` を使えるか。`/{path*}` と `/api/...` の両方が期待どおりに振り分けられるか | デプロイメントを作れない、または画面か API に届かない | パスの接頭辞を分ける(例: `/app` と `/api`)。仕様(同一オリジンの URL)の見直しを伴う |
| 15 | 同じテナンシの非公開の OCIR のリポジトリから、ポリシーなしで Function がイメージを取得できるか | Function の呼び出しが失敗する | 取得のためのポリシーを公式ドキュメントで確かめて追加する |
| 16 | API Gateway が受け取ったヘッダーのうち、どれが `Fn-Http-H-<名前>` として、どれが呼び出しそのもののヘッダーとして Function に届くか。→ 2026-09-28 の stg で、`Content-Type: application/json` を付けた `POST /api/memos` が `415` になった(`GET` の一覧は `200`、認証なしは `401`)。`ctx.httpGateway.headers` だけを見ていたため。`Content-Type` などの標準的なヘッダーは呼び出しそのもののヘッダーとして届くという情報(第三者のブログ)に合わせ、両方を合わせて渡す形にした。公式の記述は未確認。`If-Match` がどちらで届くかも未確認 → 2026-09-29 の stg で、両方を合わせて渡す形にしたあとも `POST` が `415` のままだった(応答のボディは problem+json のオブジェクト)。推測で直すのをやめ、両方のヘッダーの名前と `Content-Type`・`If-Match` の値を一時的にログに出して(`describeRequestHeaders`。`Authorization` などの値は出さない)、実際に届く形を確かめる → 2026-09-29 の診断ログ(`POST` 1 回): `httpGateway.headers` の `Content-Type` が `["application/json", "application/json"]`、呼び出しそのもののヘッダーの `Content-Type` が `["application/json"]`。`Content-Type` は `Fn-Http-H-` 付きで届いているが、同じ値が 2 つになっていた(9-28 の `415` も同じ原因とみられ、両方を合わせて渡す修正は的外れだった)。どこで重なるかは未確認。呼び出しそのもののヘッダーには API Gateway が Function を呼ぶときのヘッダーが入っていた → **確認済み**([13.1](#131-確認済み事項)) | 作成・更新が `415` になる。`If-Match` が届かなければ、更新が `428` になり、削除は照合なしで消える | `httpGateway.headers` だけを使い、同じ値の重複を 1 つにまとめる形に直した。stg で `POST` が `201`、`If-Match` 付きの `PATCH` / `DELETE` が期待どおりになるか、`If-Match` がどう届くか(診断ログ)を確かめ、確かめたら診断ログを外す |
| 17 | 同じ行の ETag(NoSQL の行のバージョン)が、読むたびに変わるのはなぜか。→ 2026-09-29 の stg で、変更していない同じ行の `POST`・`GET`・`GET` の ETag が 3 つとも違い、1 回目の `GET` の ETag を付けた `PATCH` が `412`、2 回目の `GET` の ETag を付けた `DELETE` は `204` だった(前日の確認では、`POST` の ETag を付けた `PATCH` は `200`)。1 件の取得は既定の読み取りの一貫性(`EVENTUAL`)で、どのレプリカから読むかでバージョンの表現が変わり、`putIfVersion` / `deleteIfVersion` の照合に通らないものがあると考えている。公式ドキュメントで確認できたのは「データの移動などで新しいバージョンが割り当てられることがある」「既定の読み取りは `EVENTUAL`」まで。KVLite(単一ノード)の契約テストでは出ない → **確認済み**([13.1](#131-確認済み事項)) | 画面で詳細を開いてから更新・削除すると `412` になる(競合と区別できない) | 1 件の取得を `Consistency.ABSOLUTE` にした(9.2)。stg で `GET` の ETag を付けた `PATCH` / `DELETE` が通るか、読み取り 1 ユニットで詳細の表示がスロットリングにならないかを確かめる。だめなら ETag をアプリの改訂番号にする(テーブルと 3.4 の変更を伴う) |
| 18 | コールドスタートにかかる時間。→ 2026-09-29 の stg で、しばらく呼ばれていなかったあとの最初の呼び出しが 24.8 秒かかった(Functions のログの「Served function invocation request in 24.805 seconds」。authorizer の呼び出しと VNIC の作成を含む)。直後の呼び出しは 0.03〜1.1 秒 | Function のタイムアウト(30 秒)と API Gateway の待ち時間に近く、最初の操作が失敗(`502` / `504`)したように見えることがある | 何度か測って分布を見る。超えるようなら、タイムアウトを延ばす、またはプロビジョンド・コンカレンシーを検討する(費用がかかるので仕様を更新する) |

### 13.1 確認済み事項

| 確認日 | 事項 | 結果 |
|---|---|---|
| 2026-09-28 | Vault の費用(Oracle 公式 FAQ と公開価格 API) | シークレットの保管は無料。共有型 Vault(`DEFAULT`)は作成無料で、鍵のバージョン数で課金される(ソフトウェア保護は無料、HSM 保護は 20 バージョンまで無料)。専用型は 1 時間 ¥577.22。削除猶予期間は 7〜30 日(既定 30 日)。今回の構成は月 0 円。シークレットの暗号化にソフトウェア保護の鍵を使えるかは未確認だが、HSM 保護でも無料枠内なので費用の結論は変わらない |
| 2026-09-28 | KVLite(`ghcr.io/oracle/nosql:latest-ce`)が Apple Silicon の Mac で動くか | arm64 版のイメージがあり、Colima で起動できた。Node.js SDK(`oracle-nosqldb`)で次を確認: get の version は Buffer、現在のバージョンでの putIfVersion は成功してバージョンが変わる、古いバージョンでの putIfVersion / deleteIfVersion は `success: false`、PK 単独のテーブルで `WHERE id < $after ORDER BY id DESC LIMIT $lim` により次のページが取れる。行バージョンの形式はクラウドと違う可能性があるが、opaque として扱うので問題ない |
| 2026-09-28 | KVLite に対するリポジトリの契約テスト(`npm run test:contract`) | 契約テストがすべて通った。加えて次を確認: `deleteIfVersion` に `returnExisting: true` を付けると、バージョン違いでは既存のバージョンが返り、行がなければ返らない(not_found と conflict を区別できる)。`DELETE FROM <table>` で全行を削除できる。`TIMESTAMP(3)` はミリ秒まで保たれる。limit 50 + 1 件の一覧が id の降順で返る。クラウドでの振る舞いは未確認 |
| 2026-09-29 | API Gateway から Function に届くヘッダー(13 章の 16。stg で一時的な診断ログを出して確認) | クライアントのヘッダーは `Fn-Http-H-<名前>` として届く(`If-Match` も値 1 つで届いた)。`Content-Type` だけは、呼び出しそのものの `Content-Type`(クライアントが付けた値。付けなければ `application/octet-stream`)も `Fn-Http-H-Content-Type` に入り、同じ値が 2 つになる(`application/json`・`application/json; charset=utf-8`・`text/plain` のどれも)。呼び出しそのもののヘッダーには、API Gateway が Function を呼ぶときのヘッダー(`Host`・`Date`・`User-Agent`・`Oci-Subject-*`・`X-Content-Sha256` など)が入る。`httpGateway.headers` だけを使い、同じ値の重複を 1 つにまとめる形で、`POST` は `201`(charset 付きも)、`text/plain` と `Content-Type` なしは `415`、`PATCH` は If-Match なしで `428`・正しい値で `200`・古い値で `412`、`DELETE` は古い値で `412`・正しい値で `204` になった |
| 2026-09-29 | memo-api の `204` に `Content-Type` が付くか(13 章の 7) | API Gateway を通した `DELETE` の `204` には `Content-Type` が付かず、ボディは 0 バイトだった |
| 2026-09-29 | 1 件の取得を `ABSOLUTE` にしたあとの ETag(13 章の 17。stg の `memo-api:683e1fc`) | 変更していない同じ行の `POST`・`GET`・`GET` の ETag がすべて同じになった。`GET` の ETag を付けた `PATCH` は `200`、その応答の ETag は更新後の `GET` の ETag と同じで、それを付けた `DELETE` は `204`。読み取り 1 ユニットのまま、1 件ずつの操作ではスロットリング(`429`)にならなかった。`EVENTUAL` でバージョンの表現が変わる仕組みそのものは未確認 |
| 2026-09-29 | 画面の配信(13 章の 4・5。`npm run deploy:web` のあと curl で確認) | `/` と `/index.html` は `200`・`text/html;charset=utf-8`・`Cache-Control: no-cache`、`/assets/*.js` は `text/javascript; charset=utf-8`、`/assets/*.css` は `text/css; charset=utf-8` で、どちらも `Cache-Control: public, max-age=31536000, immutable`。アップロード時に付けた Content-Type と Cache-Control が PAR と API Gateway を通して届いた。存在しないファイルは `404`。手元の OCI CLI 3.92.1 は `--cache-control` を使えた |
| 2026-09-29 | stg での画面の手動確認(`apps/web/README.md` のチェックリスト。Claude Code が Chrome を操作) | トークン・一覧・新規作成・詳細 / 編集・412・削除・未保存のまま離れる、の各項目が期待どおりだった(429 は手元の API サーバーでしか起こせないので対象外)。確かめ方の違い: 412 の「タブ A」はページ内から API を直接呼んで代わりにした。`alert` / `confirm` は差し替えて、呼ばれた文言と戻り値で確かめた(ダイアログの見た目、タブを閉じる・再読み込みするときのブラウザの確認、「入力内容をコピー」のクリップボードの中身は人が確かめる)。気づいたこと: (1) 未保存のまま「← 一覧へ」の確認でキャンセルした直後だけ、ブラウザの戻るボタンの 1 回目で確認が出ず、何も起きない(2 回目以降は確認が出る。入力内容は失われない)。(2) トークンの入力欄に `autocomplete="off"` を付けていても、Chrome のパスワードマネージャーが保存済みのトークンを自動で入れた(トークンはブラウザのパスワードマネージャーにも保存されうる) |

## 14. 範囲外

今回の仕様には含めない。

- **将来の予定**
  - GitHub Actions からの配置: `npm run deploy:web` などの同じスクリプトを GitHub Actions から実行する。認証は OCI の Workload Identity Federation で行い、長期の API キーは置かない
  - stg に対する疎通テストと E2E テスト(Playwright など)
- **扱わないもの**
  - 検索
  - タグ
  - 論理削除とゴミ箱
  - 複数ユーザーと所有者の概念(PK は `id` のまま。将来のための設計の余地も残さない)
  - 一括操作
  - 添付ファイル
  - 独自ドメインと証明書(API Gateway の既定のホスト名を使う)
  - API Gateway のレート制限
  - 監視とアラート
  - UI の自動テスト
  - `If-None-Match` などによるキャッシュ
