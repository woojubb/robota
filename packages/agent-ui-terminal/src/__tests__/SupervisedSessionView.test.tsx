import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { ScreenReaderProvider } from '../screen-reader-context.js';
import SupervisedSessionView, { type ISupervisedViewRow } from '../SupervisedSessionView.js';

const FIRST: ISupervisedViewRow = {
  id: '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4',
  liveness: 'alive', control: 'available', activity: 'working',
};
const SECOND: ISupervisedViewRow = {
  id: 'fe2c7f72-ecb3-4a05-9bb1-2563ec80e615',
  liveness: 'dead', control: 'unavailable', activity: 'unknown',
};

describe('supervised session view', () => {
  it('shows a navigable global background list without inventing completion or attach', async () => {
    const view = render(<SupervisedSessionView loadRows={async () => [FIRST, SECOND]} refreshMs={100} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(FIRST.id));
      expect(view.lastFrame()).toContain('working');
      expect(view.lastFrame()).toContain('dead');
      expect(view.lastFrame()).not.toMatch(/completed|failed|restartable|attach/i);
      view.stdin.write('\x1B[B');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${SECOND.id}`));
    } finally {
      view.unmount();
    }
  });

  it('never overlaps refreshes and aborts an in-flight probe when closed', async () => {
    let resolveSecond: ((rows: readonly ISupervisedViewRow[]) => void) | undefined;
    const pending = new Promise<readonly ISupervisedViewRow[]>((resolve) => { resolveSecond = resolve; });
    const signals: AbortSignal[] = [];
    const loadRows = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? Promise.resolve([FIRST]) : pending;
    });
    const view = render(<SupervisedSessionView loadRows={loadRows} refreshMs={20} />);
    try {
      await vi.waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      expect(loadRows).toHaveBeenCalledTimes(2);
      view.stdin.write('q');
      await vi.waitFor(() => expect(signals[1]?.aborted).toBe(true));
      resolveSecond?.([SECOND]);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      expect(loadRows).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  });

  it('keeps the selected session when activity changes reorder the groups', async () => {
    const loadRows = vi.fn()
      .mockResolvedValueOnce([FIRST, SECOND])
      .mockResolvedValue([
        { ...FIRST, liveness: 'dead', control: 'unavailable', activity: 'unknown' },
        { ...SECOND, liveness: 'alive', control: 'available', activity: 'working' },
      ]);
    const view = render(<SupervisedSessionView loadRows={loadRows} refreshMs={150} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(FIRST.id));
      view.stdin.write('\x1B[B');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${SECOND.id}`));
      await vi.waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
      expect(view.lastFrame()).toContain(`Selected ${SECOND.id}`);
    } finally {
      view.unmount();
    }
  });

  it('uses spoken state words and numbered selection in screen-reader mode', async () => {
    const view = render(
      <ScreenReaderProvider enabled>
        <SupervisedSessionView loadRows={async () => [FIRST, SECOND]} refreshMs={100} />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('1.'));
      expect(view.lastFrame()).toContain('working');
      expect(view.lastFrame()).toContain('dead');
      expect(view.lastFrame()).toContain('Enter selection (1-2)');
      view.stdin.write('2');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${SECOND.id}`));
    } finally {
      view.unmount();
    }
  });
});
