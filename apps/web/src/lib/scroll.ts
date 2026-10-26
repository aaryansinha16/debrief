export interface Span {
  top: number;
  height: number;
}

// scrollIntoView's `block: 'nearest'` for one scroller: the least movement that shows the item, its top when it cannot fit.
export function nearestScrollTop(scrollTop: number, height: number, item: Span): number {
  if (item.top < scrollTop) return item.top;
  if (item.top + item.height > scrollTop + height) {
    return Math.min(item.top, item.top + item.height - height);
  }
  return scrollTop;
}

// Never scrollIntoView here: it also scrolls the window on phones and moves Chrome's sequential focus starting point.
export function revealInList(list: HTMLElement | null, selector: string): void {
  if (list === null) return;
  const item = list.querySelector<HTMLElement>(selector);
  if (item === null) return;
  const top =
    item.getBoundingClientRect().top -
    list.getBoundingClientRect().top -
    list.clientTop +
    list.scrollTop;
  list.scrollTop = nearestScrollTop(list.scrollTop, list.clientHeight, {
    top,
    height: item.getBoundingClientRect().height,
  });
}
