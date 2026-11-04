/**
 * A question whose safe answer is the last option opens on it, so a bare Enter does not grant
 * anything. The typed shortcuts keep their meaning: `y` is the first option, `n` the second.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ConfirmPrompt from '../ConfirmPrompt.js';

describe('ConfirmPrompt opening on a chosen option', () => {
  it('highlights the option asked for, and Enter selects it', () => {
    const onSelect = vi.fn();
    const view = render(<ConfirmPrompt message="Sure?" initialIndex={1} onSelect={onSelect} />);

    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('> No');
    expect(frame).not.toContain('> Yes');

    view.stdin.write('\r');
    view.unmount();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('still answers y with the first option and n with the second', () => {
    const yes = vi.fn();
    const no = vi.fn();
    const first = render(<ConfirmPrompt message="Sure?" initialIndex={1} onSelect={yes} />);
    first.stdin.write('y');
    first.unmount();
    const second = render(<ConfirmPrompt message="Sure?" initialIndex={1} onSelect={no} />);
    second.stdin.write('n');
    second.unmount();

    expect(yes).toHaveBeenCalledExactlyOnceWith(0);
    expect(no).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('opens on the first option when the index is out of range, as it does without one', () => {
    for (const initialIndex of [undefined, -1, 2, 9]) {
      const view = render(
        <ConfirmPrompt message="Sure?" initialIndex={initialIndex} onSelect={() => undefined} />,
      );
      expect(view.lastFrame() ?? '').toContain('> Yes');
      view.unmount();
    }
  });
});
