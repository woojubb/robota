// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DiffLines } from '../DiffLines.js';

import type { IDiffLine } from '@robota-sdk/agent-interface-session';

/**
 * #3288 review SHOULD 3: a diff long enough to need it folds behind "Show more", instead of
 * dumping every line into the DOM at once; a diff already short enough to read whole never folds.
 */

afterEach(() => cleanup());

function addLines(count: number): IDiffLine[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'add' as const,
    text: `line ${i}`,
    lineNumber: i + 1,
  }));
}

describe('DiffLines folds a long diff', () => {
  it('shows a short diff in full, with no fold control', () => {
    render(<DiffLines diffLines={addLines(5)} />);
    expect(screen.getByText(/line 4/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('folds a long diff behind "Show more", and expanding it reveals the rest', () => {
    render(<DiffLines diffLines={addLines(120)} />);
    expect(screen.queryByText(/line 119/)).toBeNull();
    const button = screen.getByRole('button', { name: /show more/i });
    fireEvent.click(button);
    expect(screen.getByText(/line 119/)).toBeTruthy();
  });

  it('labels "Show more" with what expanding actually reveals, not the whole diff', () => {
    // A server-capped Edit diff can carry more than DIFF_EXPANDED_CAP_LINES (500) lines — the
    // label must promise only the 460 lines (500 - 40 folded) that clicking through produces,
    // never the full 600.
    render(<DiffLines diffLines={addLines(600)} />);
    expect(screen.getByRole('button', { name: /show more \(460 more lines\)/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(screen.getByText(/line 499/)).toBeTruthy();
    expect(screen.queryByText(/line 500/)).toBeNull();
    expect(screen.getByText(/100 more lines not shown/)).toBeTruthy();
  });
});
