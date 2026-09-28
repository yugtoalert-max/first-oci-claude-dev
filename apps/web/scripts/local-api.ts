// 手元で画面を確かめるための API サーバー(npm run dev:api -w @memo/web)。OCI には接続しない。
// memo-api のアダプター(createHandler)に、インメモリのリポジトリをつないで動かす。
// 開発サーバー(npm run dev)の /api をここに中継する(vite.config.ts)
//
// - 認証: Authorization: Bearer <LOCAL_API_TOKEN>(既定 local-dev-token)。違えば 401(ボディは problem+json にしない。API Gateway と同じく形式を保証しない)
// - 429 の確認: POST /__local/throttle?count=N で、次の N 回のリポジトリの操作をスロットリングにする
// - データはプロセスを止めると消える
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { err, type MemoRepository } from "@memo/core";
import { InMemoryMemoRepository, SequentialIdGenerator } from "@memo/core/testing";
import { createHandler } from "@memo/memo-api/handler";

const PORT = Number(process.env.LOCAL_API_PORT ?? "8787");
const TOKEN = process.env.LOCAL_API_TOKEN ?? "local-dev-token";

/** 指定した回数だけ Throttled を返すリポジトリ(NoSQL のスロットリングの代わり) */
function throttlable(inner: MemoRepository) {
  let remaining = 0;
  const gate = <T>(call: () => T) => {
    if (remaining === 0) return call();
    remaining -= 1;
    return Promise.resolve(err({ code: "THROTTLED" as const }));
  };
  const repository: MemoRepository = {
    insert: (memo) => gate(() => inner.insert(memo)),
    findById: (id) => gate(() => inner.findById(id)),
    list: (query) => gate(() => inner.list(query)),
    updateIfVersion: (memo, version) => gate(() => inner.updateIfVersion(memo, version)),
    delete: (id, version) => gate(() => inner.delete(id, version)),
  };
  return {
    repository,
    throttleNext(count: number) {
      remaining = count;
    },
  };
}

const store = throttlable(new InMemoryMemoRepository());
let requestCount = 0;
const handle = createHandler({
  repository: store.repository,
  clock: { now: () => new Date() },
  idGenerator: new SequentialIdGenerator(),
  log: (line) => console.log(line),
  timer: () => performance.now(),
});

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, headers: Record<string, string>, body = ""): void {
  response.writeHead(status, headers).end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/__local/throttle" && request.method === "POST") {
    const count = Number(url.searchParams.get("count") ?? "1");
    store.throttleNext(Number.isInteger(count) && count > 0 ? count : 1);
    send(response, 204, {});
    return;
  }

  if (!url.pathname.startsWith("/api/")) {
    send(response, 404, { "Content-Type": "text/plain" }, "Not Found");
    return;
  }

  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    send(response, 401, { "Content-Type": "text/plain", "WWW-Authenticate": "Bearer" }, "Unauthorized");
    return;
  }

  const result = await handle({
    requestId: `local-${++requestCount}`,
    method: request.method ?? "GET",
    url: url.pathname + url.search,
    headers: request.headers,
    body: await readBody(request),
  });
  send(response, result.status, result.headers, result.body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`local API: http://127.0.0.1:${PORT}/api (token: ${TOKEN})`);
});
