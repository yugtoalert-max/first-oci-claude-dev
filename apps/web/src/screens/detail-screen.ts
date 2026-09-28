import type { ApiError, EtaggedMemo } from "../api/client";
import { formatDateTime, h } from "../ui/dom";
import { buildPatch, draftToClipboardText, isDirty, type MemoDraft } from "../ui/memo-form";
import { apiErrorMessage } from "../ui/messages";
import { routeHash } from "../ui/route";
import {
  callApi,
  createRetryGate,
  createStatusLine,
  type Screen,
  type ScreenContext,
  type StatusLine,
} from "./common";
import { createMemoFormView } from "./memo-form-view";

// 詳細 / 編集と削除(SPEC 10.2・10.3)。
// GET で得た ETag を保持し、PATCH と DELETE の If-Match に付ける

export function detailScreen(id: string): Screen {
  return (container, context) => {
    const status = createStatusLine();
    container.replaceChildren(backLink(), status.element);

    let disposed = false;
    let dispose: (() => void) | undefined;

    void (async () => {
      let loaded = context.takePreloaded(id);
      if (!loaded) {
        status.info("読み込み中…");
        const result = await callApi(status, () => context.api.getMemo(id));
        if (disposed || !result) return;
        if (!result.ok) {
          status.error(apiErrorMessage(result.error));
          return;
        }
        loaded = result.value;
        status.clear();
      }
      dispose = renderEditor(container, context, status, id, loaded);
    })();

    return () => {
      disposed = true;
      dispose?.();
    };
  };
}

function backLink(): HTMLElement {
  return h("p", {}, h("a", { href: routeHash({ name: "list" }) }, "← 一覧へ"));
}

function renderEditor(
  container: HTMLElement,
  context: ScreenContext,
  status: StatusLine,
  id: string,
  loaded: EtaggedMemo,
): () => void {
  let memo = loaded.memo;
  let etag = loaded.etag;
  let saved: MemoDraft = { title: memo.title, body: memo.body };
  let busy = false;

  const meta = h("p", { className: "meta" });
  const form = createMemoFormView(saved, () => update());
  const gate = createRetryGate(() => update());
  const saveButton = h("button", { type: "submit" }, "保存");
  const deleteButton = h("button", { type: "button", className: "danger" }, "削除");

  // 412 のときの案内。入力中の内容は消さずに残す(SPEC 10.3)
  const copyResult = h("span", { className: "meta" });
  const copyButton = h("button", { type: "button" }, "入力内容をコピー");
  const reloadButton = h("button", { type: "button" }, "最新を読み込む");
  const conflict = h(
    "div",
    { className: "conflict", hidden: true },
    h("p", {}, apiErrorMessage({ status: 412, code: "PRECONDITION_FAILED" })),
    h("p", { className: "meta" }, "最新を読み込むと、入力中の内容は失われます。必要なら先にコピーしてください。"),
    h("div", { className: "actions" }, copyButton, reloadButton, copyResult),
  );

  function renderMeta() {
    meta.textContent = `作成 ${formatDateTime(memo.createdAt)} / 更新 ${formatDateTime(memo.updatedAt)}`;
  }

  function update() {
    const wait = gate.secondsLeft();
    saveButton.textContent = wait > 0 ? `保存(あと ${wait} 秒)` : "保存";
    saveButton.disabled = busy || wait > 0 || !form.isValid() || !isDirty(saved, form.draft());
    deleteButton.disabled = busy || wait > 0;
    reloadButton.disabled = busy;
  }

  function apply(value: EtaggedMemo) {
    memo = value.memo;
    etag = value.etag;
    saved = { title: memo.title, body: memo.body };
    conflict.hidden = true;
    renderMeta();
  }

  function showWriteError(error: ApiError) {
    if (error.code === "PRECONDITION_FAILED") {
      status.clear();
      copyResult.textContent = "";
      conflict.hidden = false;
      return;
    }
    if (error.code === "THROTTLED") gate.block(error.retryAfterSeconds);
    status.error(apiErrorMessage(error));
  }

  async function save() {
    const patch = buildPatch(saved, form.draft());
    if (busy || gate.secondsLeft() > 0 || !patch || !form.isValid()) return;
    busy = true;
    update();
    status.info("保存中…");
    const result = await callApi(status, () => context.api.updateMemo(id, etag, patch));
    busy = false;
    if (result?.ok) {
      // 保存中に入力が続いていても、入力欄は書き換えない(保存済みの内容だけを更新する)
      apply(result.value);
      status.success("保存しました");
    } else if (result) {
      showWriteError(result.error);
    }
    update();
  }

  async function remove() {
    const question = isDirty(saved, form.draft())
      ? "このメモを削除しますか?保存していない変更も失われます。"
      : "このメモを削除しますか?";
    if (busy || !confirm(question)) return;
    busy = true;
    update();
    status.info("削除中…");
    const result = await callApi(status, () => context.api.deleteMemo(id, etag));
    busy = false;
    // 404 はすでに消えているので、削除できたときと同じく一覧に戻る
    if (result && (result.ok || result.error.code === "NOT_FOUND")) {
      context.setLeaveGuard(() => false);
      context.go({ name: "list" }, { replace: true });
      return;
    }
    if (result) showWriteError(result.error);
    update();
  }

  async function reload() {
    busy = true;
    update();
    status.info("読み込み中…");
    const result = await callApi(status, () => context.api.getMemo(id));
    busy = false;
    if (result?.ok) {
      apply(result.value);
      form.setDraft(saved);
      status.success("最新を読み込みました");
    } else if (result) {
      status.error(apiErrorMessage(result.error));
    }
    update();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draftToClipboardText(form.draft()));
      copyResult.textContent = "コピーしました";
    } catch {
      copyResult.textContent = "コピーできませんでした。入力欄を選択して手でコピーしてください";
    }
  }

  const element = h(
    "form",
    { className: "editor" },
    backLink(),
    status.element,
    conflict,
    form.element,
    meta,
    h("div", { className: "actions" }, saveButton, deleteButton),
  );
  element.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });
  deleteButton.addEventListener("click", () => void remove());
  reloadButton.addEventListener("click", () => void reload());
  copyButton.addEventListener("click", () => void copy());

  container.replaceChildren(element);
  context.setLeaveGuard(() => isDirty(saved, form.draft()));
  renderMeta();
  update();
  return () => gate.dispose();
}
