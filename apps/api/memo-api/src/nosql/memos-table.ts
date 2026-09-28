/**
 * memos テーブルの DDL。infra/modules/nosql/main.tf と列・型を揃える(契約テストで KVLite に作るため)。
 * 本番のテーブルは Terraform で作る。揃っていることは memos-table.test.ts で確かめる
 */
export function memosTableDdl(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS ${tableName} (
  id STRING,
  title STRING,
  body STRING,
  created_at TIMESTAMP(3),
  updated_at TIMESTAMP(3),
  PRIMARY KEY (id)
)`;
}
