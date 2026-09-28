import { h } from "../ui/dom";
import { routeHash } from "../ui/route";
import type { Screen } from "./common";

export const notFoundScreen: Screen = (container) => {
  container.replaceChildren(
    h("h1", {}, "ページが見つかりません"),
    h("p", {}, h("a", { href: routeHash({ name: "list" }) }, "一覧へ")),
  );
};
