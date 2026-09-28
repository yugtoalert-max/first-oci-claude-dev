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
- ネットワーク(VCN・サブネット・Service Gateway)と NoSQL テーブルは `infra/` に作成済み。Functions・API Gateway・Vault・バケット・IAM はこれから Terraform に追加する

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
- テストランナーは Vitest
- Node.js のバージョンは、OCI Functions の Node FDK が対応する最新の LTS **(仮置き)**
  - 現時点では固定していない(`engines` や `.nvmrc` を置いていない)。FDK との接続と func.yaml を作るときに、FDK の対応状況を確認して固定する **(仮置き)**

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
- 注意: Vault の削除は即時ではなく、猶予期間 7〜30 日(既定 30 日)を経てから消える。Terraform では最短の 7 日を指定する **(仮置き)**。`terraform destroy` の直後に同じ名前で作り直すと失敗しうる。infra/README.md に追記すること

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
  - FDK との接続(エントリポイント・func.yaml)はまだ作っていない
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
- SDK の自動リトライは**合計 5 秒で打ち切る**。打ち切ったら `429` + `Retry-After`
- Function の設定: memo-api・authorizer ともに、タイムアウト 30 秒、メモリ 256MB
- テーブル名やコンパートメントは、Function の設定(環境変数)で渡す
- IAM(Terraform で作る)
  - 動的グループ: 対象コンパートメントの Functions
  - memo-api: 対象テーブルの行の読み書き
  - authorizer: 対象シークレットの読み取り
  - API Gateway: 対象 Functions の呼び出し
  - 権限は必要最小限にする

### 9.3 テスト方針

- **テストを先に書く**対象
  - `packages/core` のユースケースとバリデーション。リポジトリ・Clock・IdGenerator はインメモリの偽物を渡す
  - アダプター層の HTTP 変換(ルーティング、ステータス、ヘッダー、problem+json、4.4 の判定の順序)
  - フロントエンドの API クライアント層([10.4](#104-テスト))
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
- authorizer: 照合ロジック(ヘッダーの解釈、比較、キャッシュ)を関数として切り出してテストする。Vault からの取得は差し替えられるようにする

### 9.4 ログ

- 1 リクエスト 1 行の JSON を標準出力に書き、OCI Logging に集める
- 出す項目: リクエスト ID、メソッド、ルートのテンプレート(例: `/api/memos/{id}`)、ステータス、所要時間(ms)、エラー時の `code`
  - キー名 **(仮置き)**: `requestId` / `method` / `route` / `status` / `durationMs` / `code`(エラー時だけ) / `error`(`500` のときだけ。`name`・`message`・`stack`)
  - 定義していないルートでは `route` を `null` にする(実際のパスは出さない)**(仮置き)**
  - リクエスト ID をどのヘッダー(FDK の呼び出し ID か、API Gateway の `opc-request-id` か)から取るかは、FDK との接続を作るときに決める
- **出さないもの: `title`、`body`、トークン、`Authorization` ヘッダー**
- `500` のときは、原因の例外をログに出す(レスポンスには出さない)

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

### 10.4 テスト

- **テストを先に書く**のは API クライアント層(fetch を包む部分)だけ
  - ETag の保持と `If-Match` の付与
  - problem+json から `code` への変換(401 のボディが problem+json でない場合も含む)
  - `Retry-After` の解釈
  - カーソルの受け渡し
- UI は自動テストせず、手動の確認手順(チェックリスト)で確認する。チェックリストは `apps/web/README.md` に書く

### 10.5 配置作業

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
| 4 | API Gateway の HTTP バックエンドから PAR 経由で Object Storage に接続したとき、`/` を `index.html` として返せるか。Content-Type が保たれるか | フロントエンドの配信方式 | ルートの定義を変える。だめなら配信方式を仕様から見直す |
| 5 | `oci os object sync` で Content-Type が正しく付くか | ブラウザで JS / CSS が読み込めない | スクリプトで拡張子ごとに Content-Type を指定してアップロードする |

### 13.1 確認済み事項

| 確認日 | 事項 | 結果 |
|---|---|---|
| 2026-09-28 | Vault の費用(Oracle 公式 FAQ と公開価格 API) | シークレットの保管は無料。共有型 Vault(`DEFAULT`)は作成無料で、鍵のバージョン数で課金される(ソフトウェア保護は無料、HSM 保護は 20 バージョンまで無料)。専用型は 1 時間 ¥577.22。削除猶予期間は 7〜30 日(既定 30 日)。今回の構成は月 0 円。シークレットの暗号化にソフトウェア保護の鍵を使えるかは未確認だが、HSM 保護でも無料枠内なので費用の結論は変わらない |
| 2026-09-28 | KVLite(`ghcr.io/oracle/nosql:latest-ce`)が Apple Silicon の Mac で動くか | arm64 版のイメージがあり、Colima で起動できた。Node.js SDK(`oracle-nosqldb`)で次を確認: get の version は Buffer、現在のバージョンでの putIfVersion は成功してバージョンが変わる、古いバージョンでの putIfVersion / deleteIfVersion は `success: false`、PK 単独のテーブルで `WHERE id < $after ORDER BY id DESC LIMIT $lim` により次のページが取れる。行バージョンの形式はクラウドと違う可能性があるが、opaque として扱うので問題ない |

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
