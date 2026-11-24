import { describe, expect, it } from 'vitest';

import { FIXED_TABS, initialTab, moveTab, orderTabs } from '../menu.js';

import type { ISpaceView } from '../api.js';

const space = (id: string): ISpaceView => ({
  id,
  name: id,
  instructions: '',
  tag: id,
  pinned: [],
  opening: '',
});

describe('the tab the page opens on', () => {
  it('is the Feed when its address names it, which is where a notification from a closed page leads, and the chat otherwise', () => {
    expect(initialTab('#feed')).toBe('feed');
    for (const hash of ['', '#', '#chat', '#feed2', '#Feed', '#/feed', 'feed'])
      expect(initialTab(hash), hash).toBe('chat');
  });
});

describe('the fixed tabs', () => {
  it('end with Browse, the work the agent can take on', () => {
    expect(FIXED_TABS.at(-1)).toEqual(
      expect.objectContaining({
        id: 'browse',
        label: 'Browse',
        hint: 'Work your agent can take on',
      }),
    );
    expect(new Set(FIXED_TABS.map((tab) => tab.id)).size).toBe(FIXED_TABS.length);
  });
});

describe('the tab order', () => {
  it('puts Browse last for a person whose saved order is older than the tab', () => {
    expect(
      orderTabs(['library', 'chat', 'feed', 'ideas', 'goals', 'connectors'], [space('space-a')]),
    ).toEqual([
      'library',
      'chat',
      'feed',
      'ideas',
      'goals',
      'connectors',
      'browse',
      'space:space-a',
    ]);
    expect(orderTabs(['browse', 'chat'], [])).toEqual([
      'browse',
      'chat',
      'feed',
      'ideas',
      'goals',
      'library',
      'connectors',
    ]);
  });

  it('follows the saved order, drops tabs that are gone and adds new ones at the end', () => {
    expect(orderTabs([], [])).toEqual([
      'chat',
      'feed',
      'ideas',
      'goals',
      'library',
      'connectors',
      'browse',
    ]);
    expect(
      orderTabs(
        ['space:space-b', 'library', 'space:space-gone', 'chat', 'chat'],
        [space('space-a'), space('space-b')],
      ),
    ).toEqual([
      'space:space-b',
      'library',
      'chat',
      'feed',
      'ideas',
      'goals',
      'connectors',
      'browse',
      'space:space-a',
    ]);
  });

  it('moves one tab and ignores moves off either end', () => {
    const order = orderTabs([], []);
    expect(moveTab(order, 4, 0)).toEqual([
      'library',
      'chat',
      'feed',
      'ideas',
      'goals',
      'connectors',
      'browse',
    ]);
    expect(moveTab(order, 6, 0)[0]).toBe('browse');
    expect(moveTab(order, 0, -1)).toEqual(order);
    expect(moveTab(order, 4, 7)).toEqual(order);
  });
});
