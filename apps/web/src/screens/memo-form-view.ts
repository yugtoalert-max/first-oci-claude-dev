import { h } from "../ui/dom";
import { checkDraft, remainingBodyBytes, type MemoDraft } from "../ui/memo-form";
import { fieldErrorMessage } from "../ui/messages";

// 新規作成と編集で使う入力欄。上限の事前チェックと、body の残りのバイト数を出す(SPEC 10.3)

export type MemoFormView = {
  element: HTMLElement;
  draft(): MemoDraft;
  setDraft(draft: MemoDraft): void;
  isValid(): boolean;
};

export function createMemoFormView(initial: MemoDraft, onInput: () => void): MemoFormView {
  // maxlength は UTF-16 の長さで数えるので付けない。上限の判定は core の検証で行う
  const title = h("input", { type: "text", id: "memo-title", value: initial.title });
  const body = h("textarea", { id: "memo-body", rows: 14, value: initial.body });
  const remaining = h("p", { className: "remaining" });
  const errors = h("ul", { className: "field-errors" });

  const draft = (): MemoDraft => ({ title: title.value, body: body.value });

  function refresh() {
    const bytes = remainingBodyBytes(body.value);
    remaining.textContent = bytes >= 0 ? `本文の残り ${bytes} バイト` : `本文が ${-bytes} バイト超えています`;
    remaining.dataset.over = String(bytes < 0);
    errors.replaceChildren(...checkDraft(draft()).map((error) => h("li", {}, fieldErrorMessage(error))));
  }

  for (const field of [title, body]) {
    field.addEventListener("input", () => {
      refresh();
      onInput();
    });
  }
  refresh();

  return {
    element: h(
      "div",
      { className: "memo-form" },
      h("label", { htmlFor: "memo-title" }, "タイトル"),
      title,
      h("label", { htmlFor: "memo-body" }, "本文"),
      body,
      remaining,
      errors,
    ),
    draft,
    setDraft(next) {
      title.value = next.title;
      body.value = next.body;
      refresh();
    },
    isValid: () => checkDraft(draft()).length === 0,
  };
}
