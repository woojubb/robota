/**
 * CLI-2004 TC-05 — the role-derived, provider-invariant label vocabulary.
 *
 * The point of the negative assertion below is not tidiness: a label naming the vendor would make
 * the transcript differ between `agent-provider-*` packages for the same conversation, and a reader
 * grepping their scrollback for "assistant:" would find nothing after switching providers.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { RoleLabel } from '../RoleLabel.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';
import {
  SCREEN_READER_LABELS,
  screenReaderLabelForRole,
  screenReaderLabelValues,
} from '../screen-reader-labels.js';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

/** Every provider package this repo ships, plus the vendor names behind them. */
const VENDOR_WORDS = /(claude|anthropic|openai|gpt|gemini|google|robota|llama|mistral|copilot)/i;

function renderLabel(
  role: TUniversalMessage['role'],
  enabled: boolean,
  driverId?: string,
): string {
  const label = React.createElement(RoleLabel, driverId === undefined ? { role } : { role, driverId });
  const { lastFrame, unmount } = render(
    React.createElement(ScreenReaderProvider, { enabled, children: label }),
  );
  const frame = lastFrame() ?? '';
  unmount();
  return frame;
}

describe('TC-05: the label vocabulary', () => {
  it('covers all nine label kinds', () => {
    expect(Object.keys(SCREEN_READER_LABELS)).toHaveLength(9);
    expect(screenReaderLabelValues()).toEqual([
      'you:',
      'assistant:',
      'thinking:',
      'tool:',
      'tool error:',
      'error:',
      'warning:',
      'permission required:',
      'cost:',
    ]);
  });

  it('is entirely lowercase', () => {
    for (const label of screenReaderLabelValues()) {
      expect(label).toBe(label.toLowerCase());
    }
  });

  it('names no provider or vendor', () => {
    for (const label of screenReaderLabelValues()) {
      expect(label).not.toMatch(VENDOR_WORDS);
    }
  });

  it('maps every transcript role onto the vocabulary', () => {
    expect(screenReaderLabelForRole('user')).toBe('you:');
    expect(screenReaderLabelForRole('assistant')).toBe('assistant:');
    expect(screenReaderLabelForRole('tool')).toBe('tool:');
    expect(screenReaderLabelForRole('system')).toBe('warning:');
  });
});

describe('TC-05: RoleLabel in the mode', () => {
  it('renders `assistant:` for an assistant message — the same under every provider', () => {
    const frame = renderLabel('assistant', true);
    expect(frame).toContain('assistant:');
    expect(frame).not.toMatch(VENDOR_WORDS);
  });

  it('renders `you:` for the operator, and the driver id for a co-driven turn', () => {
    expect(renderLabel('user', true)).toContain('you:');
    expect(renderLabel('user', true, 'peer:s-1')).toContain('peer:s-1:');
  });

  it('leaves the existing labels untouched when the mode is off', () => {
    expect(renderLabel('assistant', false)).toContain('Robota:');
    expect(renderLabel('user', false)).toContain('You:');
  });
});
