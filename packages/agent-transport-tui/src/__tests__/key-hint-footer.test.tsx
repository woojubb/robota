/**
 * SCREEN-005: key-hint footer SSOT unit tests — formatter grammar, separator constant, indicator
 * constants, and the KeyHintFooter render contract (dim, leading pad, nothing when empty).
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import {
  formatKeyHints,
  KeyHintFooter,
  KEY_HINT_SEPARATOR,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from '../key-hint-footer.js';

describe('formatKeyHints', () => {
  it('joins keys+label pairs with the separator constant', () => {
    const hints: IKeyHint[] = [
      { keys: '↑↓', label: 'Navigate' },
      { keys: 'Enter', label: 'Select' },
      { keys: 'Esc', label: 'Cancel' },
    ];
    expect(formatKeyHints(hints)).toBe(
      `↑↓ Navigate${KEY_HINT_SEPARATOR}Enter Select${KEY_HINT_SEPARATOR}Esc Cancel`,
    );
  });

  it('renders a single hint without a separator', () => {
    expect(formatKeyHints([{ keys: 'Esc', label: 'Back' }])).toBe('Esc Back');
  });

  it('returns the empty string for an empty list', () => {
    expect(formatKeyHints([])).toBe('');
  });

  it('keeps the keys-before-label pair order', () => {
    expect(formatKeyHints([{ keys: 'Space', label: 'Toggle' }])).toBe('Space Toggle');
  });
});

describe('constants', () => {
  it('separator is the middle-dot idiom', () => {
    expect(KEY_HINT_SEPARATOR).toBe(' · ');
  });

  it('selection indicator and its blank counterpart are the same width', () => {
    expect(SELECTION_INDICATOR).toBe('> ');
    expect(SELECTION_INDICATOR_NONE).toBe('  ');
    expect(SELECTION_INDICATOR_NONE.length).toBe(SELECTION_INDICATOR.length);
  });
});

describe('KeyHintFooter', () => {
  it('renders the formatted hints with a leading pad', () => {
    const hints: IKeyHint[] = [
      { keys: 'Enter', label: 'Submit' },
      { keys: 'Esc', label: 'Cancel' },
    ];
    const { lastFrame } = render(<KeyHintFooter hints={hints} />);
    expect(lastFrame()).toBe(` ${formatKeyHints(hints)}`);
  });

  it('renders nothing for an empty hint list', () => {
    const { lastFrame } = render(<KeyHintFooter hints={[]} />);
    expect(lastFrame()).toBe('');
  });
});
