// 要素を作る小さな関数。文字列の子は textContent(テキストノード)として入れる。
// XSS でトークンが漏れないように、innerHTML は使わない(SPEC 10.3)

type Props<K extends keyof HTMLElementTagNameMap> = Omit<
  Partial<HTMLElementTagNameMap[K]>,
  "innerHTML" | "outerHTML"
>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props<K>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) Object.assign(element, props);
  element.append(...children);
  return element;
}

/** 日時を手元のタイムゾーンで表示する */
export function formatDateTime(date: Date): string {
  return date.toLocaleString("ja-JP");
}
