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
      view.stdin.write('1');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
    } finally {
      view.unmount();
    }
  });

  it('keeps grouped rows and controls within a 24-line terminal', async () => {
    const activities = ['needs-input', 'working', 'idle', 'unknown'] as const;
    const rows: ISupervisedViewRow[] = Array.from({ length: 17 }, (_, index) => ({
      id: `8bf9bc27-d773-4e88-b88f-${String(index).padStart(12, '0')}`,
      liveness: index === 16 ? 'dead' : 'alive',
      control: index === 15 ? 'unavailable' : 'available',
      activity: activities[index % activities.length]!,
    }));
    const view = render(<SupervisedSessionView loadRows={async () => rows} refreshMs={100} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('17 supervised session(s)'));
      const frame = view.lastFrame() ?? '';
      expect(frame.split('\n').length).toBeLessThanOrEqual(24);
      expect(frame).toContain('more below');
      expect(frame).toContain('↑↓ Navigate');
    } finally {
      view.unmount();
    }
  });

  it('requires confirmation and stops only the selected owner-controllable row', async () => {
    let finishStop: (() => void) | undefined;
    const stop = vi.fn(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const view = render(<SupervisedSessionView loadRows={async () => [FIRST, SECOND]} onStop={stop} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Stop ${FIRST.id}?`));
      expect(stop).not.toHaveBeenCalled();
      view.stdin.write('n');
      expect(stop).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain(`Stop ${FIRST.id}?`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Stop ${FIRST.id}?`));
      view.stdin.write('y');
      await vi.waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith(FIRST.id));
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Stopping'));
      view.stdin.write('q');
      expect(view.lastFrame()).toContain('Stopping');
      finishStop?.();
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Stopped ${FIRST.id}`));
    } finally {
      view.unmount();
    }
  });

  it('never offers stop for unavailable rows and leaves failures visible', async () => {
    const stop = vi.fn(async () => { throw new Error('private path must not be shown'); });
    const view = render(<SupervisedSessionView loadRows={async () => [FIRST, SECOND]} onStop={stop} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('\x1B[B');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${SECOND.id}`));
      view.stdin.write('s');
      expect(stop).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(view.lastFrame()).toContain('cannot be stopped'));
      view.stdin.write('\x1B[A');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Stop ${FIRST.id}?`));
      view.stdin.write('y');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Stop failed'));
      expect(view.lastFrame()).toContain(FIRST.id);
      expect(view.lastFrame()).not.toContain('private path');
    } finally {
      view.unmount();
    }
  });

  it('uses the same confirmed stop action after screen-reader selection', async () => {
    const stop = vi.fn(async () => undefined);
    const view = render(
      <ScreenReaderProvider enabled>
        <SupervisedSessionView loadRows={async () => [FIRST, SECOND]} onStop={stop} />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Stop ${FIRST.id}?`));
      view.stdin.write('y');
      await vi.waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith(FIRST.id));
    } finally {
      view.unmount();
    }
  });
});
