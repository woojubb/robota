import { describe, expect, it } from 'vitest';

import { resolveBackgroundFocusKey } from '../background-focus-flow.js';

const KEY = { upArrow: false, downArrow: false, return: false, escape: false };

describe('resolveBackgroundFocusKey (SCREEN-014)', () => {
  it('↓ moves down, clamped at the last item', () => {
    expect(resolveBackgroundFocusKey(0, 3, { ...KEY, downArrow: true })).toEqual({
      type: 'move',
      index: 1,
    });
    expect(resolveBackgroundFocusKey(2, 3, { ...KEY, downArrow: true })).toEqual({
      type: 'move',
      index: 2,
    });
  });

  it('↑ moves up; ↑ past the first item returns focus to the input (null)', () => {
    expect(resolveBackgroundFocusKey(2, 3, { ...KEY, upArrow: true })).toEqual({
      type: 'move',
      index: 1,
    });
    expect(resolveBackgroundFocusKey(0, 3, { ...KEY, upArrow: true })).toEqual({
      type: 'move',
      index: null,
    });
  });

  it('Enter opens the highlighted task', () => {
    expect(resolveBackgroundFocusKey(1, 3, { ...KEY, return: true })).toEqual({
      type: 'open',
      index: 1,
    });
  });

  it('Esc exits to the input', () => {
    expect(resolveBackgroundFocusKey(1, 3, { ...KEY, escape: true })).toEqual({ type: 'exit' });
  });

  it('an emptied list always exits', () => {
    expect(resolveBackgroundFocusKey(0, 0, { ...KEY, downArrow: true })).toEqual({ type: 'exit' });
  });

  it('ignores unrelated keys', () => {
    expect(resolveBackgroundFocusKey(1, 3, KEY)).toEqual({ type: 'none' });
  });
});
