import { h } from "../ui/dom";
import { normalizeTokenInput } from "../ui/token-store";

// トークン入力(SPEC 10.2・10.3)。
// 401 のときは入力中の画面を消さずに隠してこの画面を出すので、他の画面とは別に持つ

export type TokenView = {
  element: HTMLElement;
  show(message?: string): void;
  hide(): void;
};

export function createTokenView(onSubmit: (token: string) => void): TokenView {
  const message = h("p", { className: "status", hidden: true });
  message.dataset.kind = "error";
  const input = h("input", { type: "password", id: "token", autocomplete: "off" });
  const element = h(
    "form",
    { className: "token", hidden: true },
    h("h1", {}, "認証トークン"),
    message,
    h("label", { htmlFor: "token" }, "トークン"),
    input,
    h("p", { className: "meta" }, "トークンはこのタブの sessionStorage にだけ保存します。タブを閉じると消えます。"),
    h("div", { className: "actions" }, h("button", { type: "submit" }, "使う")),
  );

  element.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = normalizeTokenInput(input.value);
    if (token === undefined) {
      message.textContent = "トークンを入力してください";
      message.hidden = false;
      return;
    }
    input.value = "";
    onSubmit(token);
  });

  return {
    element,
    show(text) {
      message.textContent = text ?? "";
      message.hidden = text === undefined;
      element.hidden = false;
      input.focus();
    },
    hide() {
      element.hidden = true;
    },
  };
}
