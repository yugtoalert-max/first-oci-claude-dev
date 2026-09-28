import type { Version } from "@memo/core";

export type IfMatch = { kind: "absent" } | { kind: "invalid" } | { kind: "version"; version: Version };

export function toEtag(_version: Version): string {
  throw new Error("not implemented");
}

export function parseIfMatch(_value: string | string[] | undefined): IfMatch {
  throw new Error("not implemented");
}
