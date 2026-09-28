import { h } from "../ui/dom";
import { isDirty, type MemoDraft } from "../ui/memo-form";
import { apiErrorMessage } from "../ui/messages";
import { routeHash } from "../ui/route";
import { callApi, createRetryGate, createStatusLine, type Screen } from "./common";
import { createMemoFormView } from "./memo-form-view";

// 新規作成(SPEC 10.2)。作成できたら詳細画面に移る

const EMPTY: MemoDraft = { title: "", body: "" };

export const newScreen: Screen = (container, context) => {
  const status = createStatusLine();
  const form = createMemoFormView(EMPTY, () => update());
  const gate = createRetryGate(() => update());
  const saveButton = h("button", { type: "submit" }, "作成");
  let busy = false;

  function update() {
    const wait = gate.secondsLeft();
    saveButton.textContent = wait > 0 ? `作成(あと ${wait} 秒)` : "作成";
    saveButton.disabled = busy || wait > 0 || !form.isValid();
  }

  async function save() {
    if (busy || gate.secondsLeft() > 0 || !form.isValid()) return;
    busy = true;
    update();
    status.info("作成中…");
    const result = await callApi(status, () => context.api.createMemo(form.draft()));
    busy = false;
    update();
    if (!result) return;
    if (result.ok) {
      context.setLeaveGuard(() => false);
      context.setPreloaded(result.value);
      // 戻るボタンで空の作成画面に戻らないよう、履歴を置き換える
      context.go({ name: "detail", id: result.value.memo.id }, { replace: true });
      return;
    }
    if (result.error.code === "THROTTLED") gate.block(result.error.retryAfterSeconds);
    status.error(apiErrorMessage(result.error));
  }

  const element = h(
    "form",
    { className: "editor" },
    h("p", {}, h("a", { href: routeHash({ name: "list" }) }, "← 一覧へ")),
    h("h1", {}, "新規作成"),
    status.element,
    form.element,
    h("div", { className: "actions" }, saveButton),
  );
  element.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });

  container.replaceChildren(element);
  context.setLeaveGuard(() => isDirty(EMPTY, form.draft()));
  update();
  return () => gate.dispose();
};
