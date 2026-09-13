import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import InputArea from '../InputArea.js';

// ESC [ B — the terminal down-arrow sequence Ink parses into `key.downArrow`.
const DOWN_ARROW = '[B';

async function tick(ms = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('InputArea ↓ fall-through into the background list (SCREEN-014)', () => {
  it('requests background-list focus when ↓ is pressed on an empty input', async () => {
    const onRequestFocusBackgroundList = vi.fn();
    const { stdin } = render(
      <InputArea
        onSubmit={vi.fn()}
        isDisabled={false}
        onRequestFocusBackgroundList={onRequestFocusBackgroundList}
      />,
    );
    await tick();
    stdin.write(DOWN_ARROW);
    await tick();
    expect(onRequestFocusBackgroundList).toHaveBeenCalledTimes(1);
  });

  it('does not request focus while the input is disabled', async () => {
    const onRequestFocusBackgroundList = vi.fn();
    const { stdin } = render(
      <InputArea
        onSubmit={vi.fn()}
        isDisabled={true}
        onRequestFocusBackgroundList={onRequestFocusBackgroundList}
      />,
    );
    await tick();
    stdin.write(DOWN_ARROW);
    await tick();
    expect(onRequestFocusBackgroundList).not.toHaveBeenCalled();
  });
});
