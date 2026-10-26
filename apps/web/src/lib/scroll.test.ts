// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nearestScrollTop, revealInList } from './scroll';

const rect = (top: number, height: number): DOMRect => DOMRect.fromRect({ y: top, height });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nearestScrollTop', () => {
  it('stays put while the item shows, else moves the least, else shows its top', () => {
    expect(nearestScrollTop(100, 200, { top: 150, height: 20 })).toBe(100);
    expect(nearestScrollTop(100, 200, { top: 280, height: 20 })).toBe(100);
    expect(nearestScrollTop(100, 200, { top: 40, height: 20 })).toBe(40);
    expect(nearestScrollTop(100, 200, { top: 320, height: 20 })).toBe(140);
    expect(nearestScrollTop(100, 200, { top: 320, height: 260 })).toBe(320);
  });
});

describe('revealInList', () => {
  it('scrolls the list alone, measuring the item inside its scrolled content', () => {
    const list = document.createElement('ol');
    const item = document.createElement('li');
    list.append(item);
    document.body.append(list);
    vi.spyOn(list, 'clientHeight', 'get').mockReturnValue(100);
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect(500, 100));
    vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() =>
      rect(500 + 260 - list.scrollTop, 20),
    );
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    item.dataset.current = 'true';
    revealInList(list, '[data-current="true"]');
    expect(list.scrollTop).toBe(180);
    revealInList(list, '[data-current="true"]');
    expect(list.scrollTop).toBe(180);
    revealInList(list, '[data-current="none"]');
    revealInList(null, '[data-current="true"]');
    expect(list.scrollTop).toBe(180);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(0);
    list.remove();
  });
});
