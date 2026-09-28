// Function のイメージの中で、エントリポイントを FDK の http-stream 形式で起動し、1 回だけ呼び出す。
// OCI には接続しない。イメージが読み込めて、FDK との接続が動くかを手元で確かめるためのもの
//
// 使い方(リポジトリのルートで):
//   docker run --rm -v "$PWD/scripts/fdk-smoke.cjs:/smoke.cjs:ro" --entrypoint node \
//     -e <Function の設定>=... <image> /smoke.cjs '<Fn のヘッダーの JSON>' '<ボディ>'
// 例(memo-api に HTTP Gateway 経由の GET を送る):
//   ... memo-api:local /smoke.cjs '{"Fn-Http-Method":"GET","Fn-Http-Request-Url":"/api/memos"}' ''
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const socket = "/tmp/iofs/lsnr.sock";
const headers = { "Fn-Call-Id": "smoke-call-1", ...JSON.parse(process.argv[2] ?? "{}") };
const body = process.argv[3] ?? "";

fs.mkdirSync(path.dirname(socket), { recursive: true });
process.env.FN_FORMAT = "http-stream";
process.env.FN_LISTENER = `unix:${socket}`;
require("/function/func.cjs");

function call() {
  const request = http.request({ socketPath: socket, path: "/call", method: "POST", headers }, (response) => {
    let text = "";
    response.on("data", (chunk) => (text += chunk));
    response.on("end", () => {
      console.log(JSON.stringify({ status: response.statusCode, headers: response.headers, body: text }));
      process.exit(0);
    });
  });
  request.end(body);
}

// FDK は待ち受けを始めると、一時ファイルから socket へのシンボリックリンクを作る
const started = Date.now();
(function waitForSocket() {
  if (fs.existsSync(socket)) return call();
  if (Date.now() - started > 5000) throw new Error("FDK did not start listening");
  setTimeout(waitForSocket, 50);
})();
