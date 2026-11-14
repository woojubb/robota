import { describe, expect, it } from 'vitest';

import { moveTab, orderTabs } from '../menu.js';

import type { ISpaceView } from '../api.js';

const space = (id: string): ISpaceView => ({
  id,
  name: id,
  instructions: '',
  tag: id,
  pinned: [],
  opening: '',
});

describe('the tab order', () => {
  it('follows the saved order, drops tabs that are gone and adds new ones at the end', () => {
    expect(orderTabs([], [])).toEqual(['chat', 'feed', 'ideas', 'goals', 'library']);
    expect(
      orderTabs(
        ['space:space-b', 'library', 'space:space-gone', 'chat', 'chat'],
        [space('space-a'), space('space-b')],
      ),
    ).toEqual(['space:space-b', 'library', 'chat', 'feed', 'ideas', 'goals', 'space:space-a']);
  });

  it('moves one tab and ignores moves off either end', () => {
    const order = orderTabs([], []);
    expect(moveTab(order, 4, 0)).toEqual(['library', 'chat', 'feed', 'ideas', 'goals']);
    expect(moveTab(order, 0, -1)).toEqual(order);
    expect(moveTab(order, 4, 5)).toEqual(order);
  });
});
