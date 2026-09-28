// テスト用の組み立て。アプリケーションのコードからは使わない
import { InMemoryMemoRepository, ManualClock, SequentialIdGenerator } from "@memo/core/testing";
import { createHandler } from "./handler";
import type { HttpRequest, HttpResponse } from "./http";

export const NOW = new Date("2026-09-28T01:23:45.678Z");
export const MISSING_ID = "01J8Z3K5Q7W9X2Y4Z6A8B0C2D9";
export const JSON_HEADERS = { "Content-Type": "application/json" };

/** 呼ぶたびに 5ms 進むタイマー。所要時間を決まった値にするため */
function steppingTimer(): () => number {
  let ms = 0;
  return () => {
    ms += 5;
    return ms;
  };
}

export function setup() {
  const repository = new InMemoryMemoRepository();
  const clock = new ManualClock(NOW);
  const logs: string[] = [];
  const handle = createHandler({
    repository,
    clock,
    idGenerator: new SequentialIdGenerator(),
    log: (line) => logs.push(line),
    timer: steppingTimer(),
  });

  async function request(
    method: string,
    url: string,
    options: { headers?: HttpRequest["headers"]; body?: unknown } = {},
  ): Promise<HttpResponse> {
    const body =
      options.body === undefined
        ? ""
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body);
    return handle({ requestId: "req-1", method, url, headers: options.headers ?? {}, body });
  }

  /** メモを 1 件作り、id と ETag を返す */
  async function create(input: { title: string; body?: string } = { title: "買い物" }) {
    const response = await request("POST", "/api/memos", { headers: JSON_HEADERS, body: input });
    if (response.status !== 201) throw new Error(`create failed: ${response.status}`);
    const etag = response.headers["ETag"];
    if (etag === undefined) throw new Error("create returned no ETag");
    return { id: (JSON.parse(response.body) as { id: string }).id, etag };
  }

  return { repository, clock, logs, request, create };
}

export function json(response: HttpResponse): unknown {
  return JSON.parse(response.body);
}
