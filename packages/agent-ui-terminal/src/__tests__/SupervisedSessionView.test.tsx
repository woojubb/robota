import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { ScreenReaderProvider } from '../screen-reader-context.js';
import SupervisedSessionView, { type ISupervisedViewRow } from '../SupervisedSessionView.js';

const FIRST: ISupervisedViewRow = {
  id: '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4',
  liveness: 'alive',
  control: 'available',
  activity: 'working',
  generation: 'firstGenerationValue01',
};
const SECOND: ISupervisedViewRow = {
  id: 'fe2c7f72-ecb3-4a05-9bb1-2563ec80e615',
  liveness: 'dead',
  control: 'unavailable',
  activity: 'unknown',
};
const THIRD: ISupervisedViewRow = {
  id: '4fa26e15-b17d-4908-afed-a156f8a8a17c',
  liveness: 'alive',
  control: 'available',
  activity: 'idle',
  generation: 'thirdGenerationValue01',
};

describe('supervised session view', () => {
  it('shows a linked PR only while verified and opens it only on explicit keypress', async () => {
    const url = 'https://github.com/team/repo/pull/123';
    const onOpenPr = vi.fn(async () => undefined);
    const row = { ...FIRST, pr: { url, host: 'github.com', number: 123, kind: 'pull' as const } };
    const view = render(<SupervisedSessionView loadRows={async () => [row]} onOpenPr={onOpenPr} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('github.com #123'));
      expect(view.lastFrame()).toContain(url);
      expect(onOpenPr).not.toHaveBeenCalled();
      view.stdin.write('p');
      await vi.waitFor(() => expect(onOpenPr).toHaveBeenCalledExactlyOnceWith(FIRST.id, url, FIRST.generation));
    } finally {
      view.unmount();
    }
  });

  it('hides stale PR links and refuses open when discovery fails', async () => {
    const url = 'https://github.com/team/repo/pull/123';
    let fail = false;
    const onOpenPr = vi.fn(async () => undefined);
    const view = render(
      <SupervisedSessionView
        refreshMs={20}
        onOpenPr={onOpenPr}
        loadRows={async () => {
          if (fail) throw new Error('offline');
          return [
            { ...FIRST, pr: { url, host: 'github.com', number: 123, kind: 'pull' as const } },
          ];
        }}
      />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(url));
      fail = true;
      await vi.waitFor(() => expect(view.lastFrame()).toContain('discovery unavailable'));
      expect(view.lastFrame()).not.toContain(url);
      view.stdin.write('p');
      expect(onOpenPr).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('refreshes a replaced or cleared association without retaining the old URL', async () => {
    const first = 'https://github.com/team/repo/pull/123';
    const next = 'https://git.example.org/team/repo/-/merge_requests/24';
    let association: ISupervisedViewRow['pr'] = {
      url: first,
      host: 'github.com',
      number: 123,
      kind: 'pull',
    };
    const view = render(
      <SupervisedSessionView
        refreshMs={20}
        loadRows={async () => [{ ...FIRST, ...(association ? { pr: association } : {}) }]}
      />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(first));
      association = { url: next, host: 'git.example.org', number: 24, kind: 'merge-request' };
      await vi.waitFor(() => expect(view.lastFrame()).toContain(next));
      expect(view.lastFrame()).not.toContain(first);
      association = undefined;
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain(next));
    } finally {
      view.unmount();
    }
  });
  it('toggles verified directory grouping without losing selection or inventing unknown paths', async () => {
    const rows = [
      { ...FIRST, cwd: '/projects/alpha' },
      { ...THIRD, cwd: '/projects/beta' },
      SECOND,
    ];
    const view = render(<SupervisedSessionView loadRows={async () => rows} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      expect(view.lastFrame()).not.toContain('/projects/alpha');
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Dir 1: alpha — /projects/alpha'));
      expect(view.lastFrame()).toContain('Dir 2: beta — /projects/beta');
      expect(view.lastFrame()).toContain('Directory: unverified');
      expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`);
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('/projects/alpha'));
      expect(view.lastFrame()).toContain('working:');
    } finally {
      view.unmount();
    }
  });

  it('announces directory groups and their selection in screen-reader mode', async () => {
    const view = render(
      <ScreenReaderProvider enabled>
        <SupervisedSessionView
          loadRows={async () => [{ ...FIRST, cwd: '/projects/alpha' }, SECOND]}
        />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Dir 1: alpha — /projects/alpha'));
      expect(view.lastFrame()).toContain('Directory: unverified');
      expect(view.lastFrame()).toContain('Enter selection (1-2)');
      view.stdin.write('?');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('g Group state/dir'));
    } finally {
      view.unmount();
    }
  });

  it('keeps long directory headings within a narrow terminal viewport', async () => {
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [
          { ...FIRST, cwd: `/projects/${'very-long-directory-name-'.repeat(8)}` },
        ]}
      />,
    );
    try {
      Object.defineProperty(view.stdout, 'columns', { value: 20 });
      view.stdout.emit('resize');
      await vi.waitFor(() =>
        expect(view.lastFrame()).toContain(`Selected ${FIRST.id.slice(0, 8)}`),
      );
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Dir 1:'));
      expect((view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    } finally {
      view.unmount();
    }
  });

  it('distinguishes directory groups with a shared prefix in a narrow terminal', async () => {
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [
          { ...FIRST, cwd: '/projects/alpha' },
          { ...THIRD, cwd: '/projects/beta' },
        ]}
      />,
    );
    try {
      Object.defineProperty(view.stdout, 'columns', { value: 20 });
      view.stdout.emit('resize');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('2 supervised'));
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Dir 1: alpha'));
      expect(view.lastFrame()).toContain('Dir 2: beta');
    } finally {
      view.unmount();
    }
  });

  it('shows differing parent directories when project basenames match at 20 columns', async () => {
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [
          { ...FIRST, cwd: '/projects/alpha/app' },
          { ...THIRD, cwd: '/projects/beta/app' },
        ]}
      />,
    );
    try {
      Object.defineProperty(view.stdout, 'columns', { value: 20 });
      view.stdout.emit('resize');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('2 supervised'));
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('alpha/app'));
      expect(view.lastFrame()).toContain('beta/app');
    } finally {
      view.unmount();
    }
  });

  it('keeps the differing path portion visible when long parent names share a prefix', async () => {
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [
          { ...FIRST, cwd: '/projects/alpha-very-long-parent/app' },
          { ...THIRD, cwd: '/projects/alpha-very-long-pardon/app' },
        ]}
      />,
    );
    try {
      Object.defineProperty(view.stdout, 'columns', { value: 20 });
      view.stdout.emit('resize');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('2 supervised'));
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('ent/app'));
      expect(view.lastFrame()).toContain('don/app');
    } finally {
      view.unmount();
    }
  });

  it('keeps the distinguishing wide character visible in a 20-column terminal', async () => {
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [
          { ...FIRST, cwd: '/projects/あいうえおかきくけこ甲' },
          { ...THIRD, cwd: '/projects/あいうえおかきくけこ乙' },
        ]}
      />,
    );
    try {
      Object.defineProperty(view.stdout, 'columns', { value: 20 });
      view.stdout.emit('resize');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('2 supervised'));
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('甲'));
      expect(view.lastFrame()).toContain('乙');
      expect((view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    } finally {
      view.unmount();
    }
  });

  it('escapes layout controls in verified directory headings', async () => {
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [{ ...FIRST, cwd: '/projects/line\nbreak/app' }]}
      />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Dir 1:'));
      expect(view.lastFrame()).toContain('line\\u{a}break/app');
      expect(view.lastFrame()).not.toContain('line\nbreak/app');
      expect((view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    } finally {
      view.unmount();
    }
  });

  it('clears a pending screen-reader number before directory regrouping', async () => {
    const view = render(
      <ScreenReaderProvider enabled>
        <SupervisedSessionView
          loadRows={async () => [
            { ...FIRST, cwd: '/projects/z' },
            { ...THIRD, cwd: '/projects/a' },
          ]}
        />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('1');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Escape to cancel 1'));
      view.stdin.write('g');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Dir 1: projects/a'));
      expect(view.lastFrame()).not.toContain('Escape to cancel 1');
      view.stdin.write('\r');
      expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`);
    } finally {
      view.unmount();
    }
  });

  it('filters by an observed group without treating dead or unverified rows as idle', async () => {
    const view = render(
      <SupervisedSessionView loadRows={async () => [FIRST, SECOND, THIRD]} stateFilter="idle" />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${THIRD.id}`));
      expect(view.lastFrame()).toContain('State: idle');
      expect(view.lastFrame()).not.toContain(FIRST.id);
      expect(view.lastFrame()).not.toContain(SECOND.id);
    } finally {
      view.unmount();
    }
  });

  it('shows an observed loop eligibility countdown without changing idle into a process state', async () => {
    const nextLoopAt = new Date(Date.now() + 1_200).toISOString();
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [{ ...THIRD, nextLoopAt }]}
        stateFilter="idle"
        refreshMs={100}
      />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('loop eligible in'));
      expect(view.lastFrame()).toContain('activity idle');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('loop eligible now'), {
        timeout: 3_000,
      });
    } finally {
      view.unmount();
    }
  });

  it('includes the loop eligibility label in screen-reader output', async () => {
    const nextLoopAt = new Date(Date.now() + 60_000).toISOString();
    const view = render(
      <ScreenReaderProvider enabled>
        <SupervisedSessionView loadRows={async () => [{ ...THIRD, nextLoopAt }]} />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('loop eligible in'));
      expect(view.lastFrame()).toContain('activity idle');
    } finally {
      view.unmount();
    }
  });

  it('never renders loaded rows without a selection', async () => {
    const view = render(
      <SupervisedSessionView loadRows={async () => [{ ...THIRD, name: 'Morning review' }]} />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Morning review'));
      const withRows = view.frames.filter((frame) => frame.includes('Morning review'));
      expect(withRows.length).toBeGreaterThan(0);
      for (const frame of withRows) expect(frame).toContain(`Selected ${THIRD.id}`);
    } finally {
      view.unmount();
    }
  });

  it('shows a verified human name while preserving the exact selected ID', async () => {
    const view = render(
      <SupervisedSessionView loadRows={async () => [{ ...THIRD, name: 'Morning review' }]} />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Morning review'));
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${THIRD.id}`));
      expect(view.lastFrame()).toContain('activity idle');
    } finally {
      view.unmount();
    }
  });

  it('starts a new background session without closing the view', async () => {
    const start = vi.fn(async () => SECOND.id);
    const view = render(<SupervisedSessionView loadRows={async () => [FIRST]} onStart={start} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('n');
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Started ${SECOND.id}`));
      expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`);
      view.stdin.write('?');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('n New session'));
    } finally {
      view.unmount();
    }
  });

  it('keeps stop cancellation separate from starting a session', async () => {
    const start = vi.fn(async () => SECOND.id);
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [FIRST]}
        onStart={start}
        onStop={async () => undefined}
      />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('y Yes / n No'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('y Yes / n No'));
      expect(start).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('can start from an empty view and hides private launch errors', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error('/private/token-path'))
      .mockResolvedValueOnce(SECOND.id);
    const view = render(<SupervisedSessionView loadRows={async () => []} onStart={start} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No supervised sessions'));
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Start failed'));
      expect(view.lastFrame()).not.toContain('/private/token-path');
      view.stdin.write('n');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Started ${SECOND.id}`));
      expect(start).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  });

  it('does not stop a row that leaves the selected state while confirmation is open', async () => {
    let finishRefresh: ((rows: readonly ISupervisedViewRow[]) => void) | undefined;
    const refresh = new Promise<readonly ISupervisedViewRow[]>((resolve) => {
      finishRefresh = resolve;
    });
    const loadRows = vi
      .fn()
      .mockResolvedValueOnce([THIRD])
      .mockImplementation(() => refresh);
    const stop = vi.fn(async () => undefined);
    const view = render(
      <SupervisedSessionView
        loadRows={loadRows}
        onStop={stop}
        stateFilter="idle"
        refreshMs={100}
      />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${THIRD.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('y Yes / n No'));
      await vi.waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
      finishRefresh?.([{ ...THIRD, activity: 'working' }]);
      await vi.waitFor(() => expect(view.lastFrame()).toContain('0 supervised session(s)'));
      view.stdin.write('y');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('cannot be stopped'));
      expect(stop).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('lists every active key in help even in a narrow, crowded terminal', async () => {
    const rows = Array.from({ length: 18 }, (_, index) => ({
      ...FIRST,
      id: `8bf9bc27-d773-4e88-b88f-${String(index).padStart(12, '0')}`,
    }));
    const view = render(
      <SupervisedSessionView loadRows={async () => rows} onStart={async () => SECOND.id} />,
    );
    try {
      Object.defineProperty(view.stdout, 'columns', { value: 20 });
      view.stdout.emit('resize');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('18 supervised'));
      view.stdin.write('?');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Keys:'));
      for (const key of [
        '↑/↓ Select',
        's Request stop',
        'g Group state/dir',
        'n New session',
        'y Confirm stop',
        'n/Esc Cancel stop',
        'q/Esc/Ctrl+C Close',
        '? Toggle help',
      ]) {
        expect(view.lastFrame()).toContain(key);
      }
      expect((view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    } finally {
      view.unmount();
    }
  });

  it('announces an active directory filter without printing its path', async () => {
    const view = render(<SupervisedSessionView loadRows={async () => [FIRST]} filteredByCwd />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(FIRST.id));
      expect(view.lastFrame()).toContain('Background sessions in selected directory');
      expect(view.lastFrame()).not.toContain('/private/project');
    } finally {
      view.unmount();
    }
  });

  it('shows a navigable global background list without inventing completion or attach', async () => {
    const view = render(
      <SupervisedSessionView loadRows={async () => [FIRST, SECOND]} refreshMs={100} />,
    );
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
    const pending = new Promise<readonly ISupervisedViewRow[]>((resolve) => {
      resolveSecond = resolve;
    });
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
    // The reordering refresh is released only after the selection moved, so the test cannot race
    // the refresh timer against the keypress.
    let releaseReorder: ((rows: readonly ISupervisedViewRow[]) => void) | undefined;
    const reordered = new Promise<readonly ISupervisedViewRow[]>((resolve) => {
      releaseReorder = resolve;
    });
    const loadRows = vi
      .fn()
      .mockResolvedValueOnce([FIRST, SECOND])
      .mockImplementation(() => reordered);
    const view = render(<SupervisedSessionView loadRows={loadRows} refreshMs={20} />);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('\x1B[B');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${SECOND.id}`));
      await vi.waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
      releaseReorder?.([
        { ...FIRST, liveness: 'dead', control: 'unavailable', activity: 'unknown' },
        { ...SECOND, liveness: 'alive', control: 'available', activity: 'working', generation: 'secondGenerationValue1' },
      ]);
      // Wait for the reordered list itself: SECOND listed under `working:`, FIRST under `dead:`.
      const rowLine = (lines: readonly string[], id: string): number =>
        lines.findIndex((line) => line.includes(id) && !line.startsWith('Selected'));
      await vi.waitFor(() => {
        const lines = (view.lastFrame() ?? '').split('\n');
        const working = lines.indexOf('working:');
        const dead = lines.indexOf('dead:');
        expect(working).toBeGreaterThanOrEqual(0);
        expect(rowLine(lines, SECOND.id)).toBe(working + 1);
        expect(rowLine(lines, FIRST.id)).toBe(dead + 1);
      });
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
      view.stdin.write('?');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Number+Enter Select'));
      expect(view.lastFrame()).not.toContain('↑/↓ Select');
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

  it('keeps stop confirmation and controls visible in a narrow 24-line terminal', async () => {
    const rows: ISupervisedViewRow[] = Array.from({ length: 22 }, (_, index) => ({
      ...FIRST,
      id: `8bf9bc27-d773-4e88-b88f-${String(index).padStart(12, '0')}`,
    }));
    const view = render(
      <SupervisedSessionView loadRows={async () => rows} onStop={async () => undefined} />,
    );
    try {
      Object.defineProperty(view.stdout, 'columns', { value: 40 });
      view.stdout.emit('resize');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Selected'));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Stop …00000000?'));
      expect(view.lastFrame()).toContain('y Yes / n No');
      const frame = view.lastFrame() ?? '';
      expect(frame.split('\n').length).toBeLessThanOrEqual(24);
      expect(frame).toContain('Confirm stop or cancel before closing.');
    } finally {
      view.unmount();
    }
  });

  it('identifies the selected stop target even at 20 columns with matching UUID prefixes', async () => {
    const similar = { ...FIRST, id: `${FIRST.id.slice(0, -8)}ffffffff` };
    const view = render(
      <SupervisedSessionView
        loadRows={async () => [FIRST, similar]}
        onStop={async () => undefined}
      />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('\x1B[B');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${similar.id}`));
      Object.defineProperty(view.stdout, 'columns', { value: 20 });
      view.stdout.emit('resize');
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Stop …ffffffff?'));
      expect(view.lastFrame()).toContain('y Yes / n No');
      expect((view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    } finally {
      view.unmount();
    }
  });

  it('requires confirmation and stops only the selected owner-controllable row', async () => {
    let finishStop: (() => void) | undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    const view = render(
      <SupervisedSessionView loadRows={async () => [FIRST, SECOND]} onStop={stop} />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('y Yes / n No'));
      expect(stop).not.toHaveBeenCalled();
      view.stdin.write('n');
      expect(stop).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain('y Yes / n No'));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('y Yes / n No'));
      view.stdin.write('y');
      await vi.waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith(FIRST.id, FIRST.generation));
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Stopping'));
      expect(view.lastFrame()).toContain('Stop in progress; wait for result.');
      expect(view.lastFrame()).not.toContain('q/Esc Close');
      view.stdin.write('q');
      view.stdin.write('\x1B');
      view.stdin.write('\x03');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(view.lastFrame()).toContain('Stopping');
      finishStop?.();
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Stopped ${FIRST.id}`));
    } finally {
      view.unmount();
    }
  });

  it('refuses a stop when polling removes control while confirmation is open', async () => {
    let finishRefresh: ((rows: readonly ISupervisedViewRow[]) => void) | undefined;
    const refresh = new Promise<readonly ISupervisedViewRow[]>((resolve) => {
      finishRefresh = resolve;
    });
    const loadRows = vi
      .fn()
      .mockResolvedValueOnce([FIRST])
      .mockImplementation(() => refresh);
    const stop = vi.fn(async () => undefined);
    const view = render(
      <SupervisedSessionView loadRows={loadRows} onStop={stop} refreshMs={100} />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('y Yes / n No'));
      await vi.waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
      finishRefresh?.([{ ...FIRST, control: 'unavailable', activity: 'unknown' }]);
      await vi.waitFor(() => expect(view.lastFrame()).toContain('control unavailable'));
      view.stdin.write('y');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('cannot be stopped'));
      expect(stop).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('never offers stop for unavailable rows and leaves failures visible', async () => {
    const stop = vi.fn(async () => {
      throw new Error('private path must not be shown');
    });
    const view = render(
      <SupervisedSessionView loadRows={async () => [FIRST, SECOND]} onStop={stop} />,
    );
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
      await vi.waitFor(() => expect(view.lastFrame()).toContain('y Yes / n No'));
      view.stdin.write('y');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Stop failed'));
      expect(view.lastFrame()).toContain(FIRST.id);
      expect(view.lastFrame()).not.toContain('private path');
    } finally {
      view.unmount();
    }
  });

  it('selects when a typed number and Enter arrive in one input chunk', async () => {
    const view = render(
      <ScreenReaderProvider enabled>
        <SupervisedSessionView loadRows={async () => [FIRST, THIRD]} />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('2\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${THIRD.id}`));
    } finally {
      view.unmount();
    }
  });

  it('uses the same confirmed stop action after screen-reader selection', async () => {
    const stop = vi.fn(async () => undefined);
    const view = render(
      <ScreenReaderProvider enabled>
        <SupervisedSessionView loadRows={async () => [FIRST, SECOND, THIRD]} onStop={stop} />
      </ScreenReaderProvider>,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('2');
      view.stdin.write('\r');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${THIRD.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Stop ${THIRD.id}?`));
      expect(view.lastFrame()).not.toContain('Enter selection');
      view.stdin.write('y');
      await vi.waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith(THIRD.id, THIRD.generation));
    } finally {
      view.unmount();
    }
  });
  it('refuses a stop when the session restarts under the same id while confirmation is open', async () => {
    let finishRefresh: ((rows: readonly ISupervisedViewRow[]) => void) | undefined;
    const refresh = new Promise<readonly ISupervisedViewRow[]>((resolve) => {
      finishRefresh = resolve;
    });
    const loadRows = vi
      .fn()
      .mockResolvedValueOnce([FIRST])
      .mockImplementation(() => refresh);
    const stop = vi.fn(async () => undefined);
    const view = render(
      <SupervisedSessionView loadRows={loadRows} onStop={stop} refreshMs={100} />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('y Yes / n No'));
      await vi.waitFor(() => expect(loadRows).toHaveBeenCalledTimes(2));
      finishRefresh?.([{ ...FIRST, generation: 'restartedGeneration001' }]);
      await vi.waitFor(() => expect(loadRows).toHaveBeenCalledTimes(3));
      view.stdin.write('y');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('cannot be stopped'));
      expect(stop).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('never offers stop or PR open for a row without a verified generation', async () => {
    const stop = vi.fn(async () => undefined);
    const onOpenPr = vi.fn(async () => undefined);
    const { generation: _generation, ...unbound } = FIRST;
    const row: ISupervisedViewRow = {
      ...unbound,
      name: 'Unbound name',
      pr: { url: 'https://github.com/team/repo/pull/9', host: 'github.com', number: 9, kind: 'pull' },
    };
    const view = render(
      <SupervisedSessionView loadRows={async () => [row]} onStop={stop} onOpenPr={onOpenPr} />,
    );
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain(`Selected ${FIRST.id}`));
      expect(view.lastFrame()).toContain('unverified:');
      expect(view.lastFrame()).not.toContain('Unbound name');
      expect(view.lastFrame()).not.toContain('github.com');
      view.stdin.write('s');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('cannot be stopped'));
      expect(view.lastFrame()).not.toContain('y Yes / n No');
      view.stdin.write('p');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('No verified PR link'));
      expect(stop).not.toHaveBeenCalled();
      expect(onOpenPr).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });
});
