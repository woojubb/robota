/**
 * SCREEN-003 TC-01 — the input box's bottom border is an always-present hand-drawn `<Text>` row,
 * not a Yoga-synthesized Box border that can drop glyphs under rapid re-render. Deterministic guard:
 * the last rendered line is a full-width run of `─`, identical to the top border, in BOTH the
 * streaming (`isDisabled`) state (where the flicker appeared) and the idle state.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import InputArea from '../InputArea.js';

const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

function borderLines(frame: string): { first: string; last: string; all: string[] } {
  const lines = stripAnsi(frame)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  const nonEmpty = lines.filter((l) => l.length > 0);
  return { first: nonEmpty[0], last: nonEmpty[nonEmpty.length - 1], all: nonEmpty };
}

async function tick(ms = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('InputArea bottom border stability (SCREEN-003)', () => {
  for (const isDisabled of [true, false]) {
    it(`renders a full-width \`─\` bottom border row (isDisabled=${isDisabled})`, async () => {
      const { lastFrame } = render(<InputArea onSubmit={vi.fn()} isDisabled={isDisabled} />);
      await tick();

      const { first, last } = borderLines(lastFrame() ?? '');

      // Bottom border is present and is a pure run of the horizontal box glyph.
      expect(last).toMatch(/^─+$/);
      // Top border is the same hand-drawn full-width run — both share `innerWidth`.
      expect(first).toMatch(/^─+$/);
      expect(last).toBe(first);
      expect(last.length).toBeGreaterThan(0);
    });
  }
});
