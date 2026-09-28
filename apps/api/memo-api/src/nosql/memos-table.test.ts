import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { memosTableDdl } from "./memos-table";

// 契約テストで KVLite に作るテーブルを、Terraform のテーブル定義と揃える

const TERRAFORM = new URL("../../../../../infra/modules/nosql/main.tf", import.meta.url);

function terraformDdl(tableName: string): string {
  const source = readFileSync(TERRAFORM, "utf8");
  const heredoc = /ddl_statement = <<-EOT\n([\s\S]*?)\n\s*EOT/.exec(source)?.[1];
  if (heredoc === undefined) throw new Error("ddl_statement not found in main.tf");
  return heredoc.replaceAll("${var.table_name}", tableName);
}

function normalize(ddl: string): string {
  return ddl.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim();
}

describe("memosTableDdl", () => {
  it("infra/modules/nosql/main.tf の DDL と同じ列・型・主キー", () => {
    expect(normalize(memosTableDdl("memos_contract_test"))).toBe(
      normalize(terraformDdl("memos_contract_test")),
    );
  });
});
