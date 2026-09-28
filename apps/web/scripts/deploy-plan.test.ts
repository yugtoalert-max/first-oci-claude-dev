import { describe, expect, it } from "vitest";
import { cacheControlFor, contentTypeFor, planDeletions, planUploads } from "./deploy-plan.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";

describe("contentTypeFor", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["assets/index-abc.js", "text/javascript; charset=utf-8"],
    ["assets/index-abc.mjs", "text/javascript; charset=utf-8"],
    ["assets/index-abc.css", "text/css; charset=utf-8"],
    ["assets/index-abc.js.map", "application/json"],
    ["manifest.json", "application/json"],
    ["site.webmanifest", "application/manifest+json"],
    ["robots.txt", "text/plain; charset=utf-8"],
    ["assets/logo-abc.svg", "image/svg+xml"],
    ["assets/a.png", "image/png"],
    ["assets/a.jpg", "image/jpeg"],
    ["assets/a.jpeg", "image/jpeg"],
    ["assets/a.gif", "image/gif"],
    ["assets/a.webp", "image/webp"],
    ["favicon.ico", "image/x-icon"],
    ["assets/font-abc.woff2", "font/woff2"],
    ["assets/font-abc.woff", "font/woff"],
  ])("%s → %s", (name, expected) => {
    expect(contentTypeFor(name)).toBe(expected);
  });

  it("拡張子の大文字・小文字は区別しない", () => {
    expect(contentTypeFor("assets/A.PNG")).toBe("image/png");
  });

  it("知らない拡張子や拡張子なしは、黙って推測せずに例外を投げる", () => {
    expect(() => contentTypeFor("assets/data.bin")).toThrow(/assets\/data\.bin/);
    expect(() => contentTypeFor("LICENSE")).toThrow(/LICENSE/);
  });

  it("ディレクトリ名のドットは拡張子として扱わない", () => {
    expect(() => contentTypeFor("v1.2/LICENSE")).toThrow(/v1\.2\/LICENSE/);
  });
});

describe("cacheControlFor", () => {
  it("index.html は no-cache", () => {
    expect(cacheControlFor("index.html")).toBe("no-cache");
  });

  it("assets/ の下(ハッシュ付きのファイル)は長期の immutable", () => {
    expect(cacheControlFor("assets/index-abc.js")).toBe(IMMUTABLE);
    expect(cacheControlFor("assets/sub/x-abc.png")).toBe(IMMUTABLE);
  });

  it("それ以外(public/ から来るハッシュなしのファイル)は no-cache", () => {
    expect(cacheControlFor("favicon.ico")).toBe("no-cache");
    expect(cacheControlFor("docs/index.html")).toBe("no-cache");
  });
});

describe("planUploads", () => {
  it("assets/* を先に、その他を次に、index.html を最後に並べる(各グループの中は名前順)", () => {
    const plan = planUploads([
      "index.html",
      "favicon.ico",
      "assets/index-b.js",
      "robots.txt",
      "assets/index-a.css",
    ]);
    expect(plan.map((upload) => upload.name)).toEqual([
      "assets/index-a.css",
      "assets/index-b.js",
      "favicon.ico",
      "robots.txt",
      "index.html",
    ]);
  });

  it("各ファイルに Content-Type と Cache-Control を付ける", () => {
    expect(planUploads(["index.html", "assets/index-a.js"])).toEqual([
      {
        name: "assets/index-a.js",
        contentType: "text/javascript; charset=utf-8",
        cacheControl: IMMUTABLE,
      },
      { name: "index.html", contentType: "text/html; charset=utf-8", cacheControl: "no-cache" },
    ]);
  });

  it("index.html がなければ例外(ビルドしていない、または別のディレクトリを指している)", () => {
    expect(() => planUploads(["assets/index-a.js"])).toThrow(/index\.html/);
    expect(() => planUploads([])).toThrow(/index\.html/);
  });

  it("Content-Type を決められないファイルがあれば、アップロードを始める前に例外", () => {
    expect(() => planUploads(["index.html", "assets/data.bin"])).toThrow(/assets\/data\.bin/);
  });
});

describe("planDeletions", () => {
  it("バケットにあって dist/ にないものを、名前順で返す", () => {
    expect(
      planDeletions(
        ["index.html", "assets/index-old.js", "assets/index-new.js", "assets/index-old.css"],
        ["index.html", "assets/index-new.js"],
      ),
    ).toEqual(["assets/index-old.css", "assets/index-old.js"]);
  });

  it("消すものがなければ空", () => {
    expect(planDeletions(["index.html"], ["index.html", "assets/a.js"])).toEqual([]);
    expect(planDeletions([], ["index.html"])).toEqual([]);
  });
});
