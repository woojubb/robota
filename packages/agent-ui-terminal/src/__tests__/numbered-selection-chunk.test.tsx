import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import MultiSelectList from '../MultiSelectList.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('numbered selection with chunked input', () => {
  it('acts on the first keystroke of a chunk and leaves the checklist usable', async () => {
    const onConfirm = vi.fn();
    const view = render(
      <ScreenReaderProvider enabled>
        <MultiSelectList
          title="Pick"
          options={OPTIONS}
          minSelect={1}
          maxSelect={2}
          onConfirm={onConfirm}
          onCancel={() => undefined}
        />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Alpha'));
      // Toggle row 1 and commit, delivered as one chunk: the toggle lands, the rest is dropped.
      view.stdin.write('1\r\r');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onConfirm).not.toHaveBeenCalled();
      // A later Enter commits with the toggled row, so the checklist is not stuck.
      view.stdin.write('\r');
      await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledExactlyOnceWith(['a']));
    } finally {
      view.unmount();
    }
  });
});
