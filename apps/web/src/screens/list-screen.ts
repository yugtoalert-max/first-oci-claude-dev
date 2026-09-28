import { formatDateTime, h } from "../ui/dom";
import { apiErrorMessage } from "../ui/messages";
import { routeHash } from "../ui/route";
import { callApi, createStatusLine, type Screen } from "./common";

// 一覧(SPEC 10.3)。新しい順。「もっと見る」で nextCursor を使って次を読み込む。無限スクロールにはしない

export const listScreen: Screen = (container, context) => {
  const status = createStatusLine();
  const items = h("ul", { className: "memo-list" });
  const empty = h("p", { hidden: true }, "メモはまだありません");
  const more = h("button", { type: "button", hidden: true }, "もっと見る");

  container.replaceChildren(
    h(
      "header",
      {},
      h("h1", {}, "メモ"),
      h("a", { href: routeHash({ name: "new" }), className: "button" }, "新規作成"),
    ),
    status.element,
    empty,
    items,
    more,
  );

  let cursor: string | undefined;

  async function load() {
    more.disabled = true;
    status.info("読み込み中…");
    const result = await callApi(status, () =>
      context.api.listMemos(cursor === undefined ? {} : { cursor }),
    );
    more.disabled = false;
    if (!result) return;
    if (!result.ok) {
      status.error(apiErrorMessage(result.error));
      return;
    }

    status.clear();
    const page = result.value;
    for (const memo of page.items) {
      items.append(
        h(
          "li",
          {},
          h("a", { href: routeHash({ name: "detail", id: memo.id }) }, memo.title),
          h(
            "time",
            { className: "meta", dateTime: memo.updatedAt.toISOString() },
            `更新 ${formatDateTime(memo.updatedAt)}`,
          ),
        ),
      );
    }
    empty.hidden = items.childElementCount > 0;
    cursor = page.nextCursor ?? undefined;
    more.hidden = page.nextCursor === null;
  }

  more.addEventListener("click", () => void load());
  void load();
};
