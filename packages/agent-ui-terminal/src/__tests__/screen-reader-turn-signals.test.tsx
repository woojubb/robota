/**
 * CLI-2004 — the long-tool bell, at the hook that decides when a tool finished.
 *
 * `attention-bell.ts` already has its own tests, and they pass whatever this hook feeds it. The
 * defect the review found lives HERE: completion was inferred from an entry leaving `activeTools`,
 * while the session replaces the finished entry in place (`tui-state-manager.ts` `onToolEnd`) and
 * empties the array only at turn end. Under that reading a one-second tool inside a ten-second turn
 * rings, and every tool rings at once when the turn ends.
 *
 * So this drives the hook with the state sequence the session actually produces — running, then the
 * same entry with `isRunning: false` — and asserts the bell against the clock.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BELL, LONG_TOOL_BELL_MS } from '../attention-bell.js';
import { useScreenReaderTurnSignals } from '../hooks/useScreenReaderTurnSignals.js';

import type { IToolState } from '@robota-sdk/agent-interface-session';

function tool(overrides: Partial<IToolState> = {}): IToolState {
  return { toolName: 'Bash', firstArg: 'ls', isRunning: true, ...overrides };
}

function Probe({ activeTools }: { activeTools: readonly IToolState[] }): React.ReactElement {
  useScreenReaderTurnSignals({
    enabled: true,
    isThinking: true,
    activeTools,
    awaitingAnswer: false,
  });
  return <></>;
}

/** Bell bytes written to stdout, with the writer restored afterwards. */
let bells: string[];
let restore: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  bells = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      if (typeof chunk === 'string' && chunk.includes(BELL)) {
        bells.push(chunk);
        return true;
      }
      return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
    });
  restore = (): void => spy.mockRestore();
});

afterEach(() => {
  restore();
  vi.useRealTimers();
});

describe('CLI-2004 — the long-tool bell fires on the isRunning transition', () => {
  it('rings when a tool that outlived the threshold reports isRunning: false', () => {
    const { rerender, unmount } = render(<Probe activeTools={[tool()]} />);
    vi.advanceTimersByTime(LONG_TOOL_BELL_MS + 1000);
    // The session REPLACES the entry in place; the array never shrinks.
    rerender(<Probe activeTools={[tool({ isRunning: false, result: 'success' })]} />);
    unmount();

    expect(bells).toHaveLength(1);
  });

  it('stays silent for a short tool, even though its entry is still in the array', () => {
    const { rerender, unmount } = render(<Probe activeTools={[tool()]} />);
    vi.advanceTimersByTime(1000);
    rerender(<Probe activeTools={[tool({ isRunning: false, result: 'success' })]} />);
    unmount();

    expect(bells).toEqual([]);
  });

  it('does not ring a short tool a second time when the turn later empties the array', () => {
    const { rerender, unmount } = render(<Probe activeTools={[tool()]} />);
    vi.advanceTimersByTime(1000);
    rerender(<Probe activeTools={[tool({ isRunning: false, result: 'success' })]} />);
    vi.advanceTimersByTime(LONG_TOOL_BELL_MS + 1000);
    // `onThinking(false)` clears activeTools — the completion already happened above.
    rerender(<Probe activeTools={[]} />);
    unmount();

    expect(bells).toEqual([]);
  });

  it('tracks concurrent runs of the same tool separately by executionId', () => {
    const first = tool({ toolName: 'Bash', executionId: 'e1' });
    const second = tool({ toolName: 'Bash', executionId: 'e2' });
    const { rerender, unmount } = render(<Probe activeTools={[first]} />);
    vi.advanceTimersByTime(LONG_TOOL_BELL_MS + 1000);
    rerender(<Probe activeTools={[first, second]} />);
    vi.advanceTimersByTime(1000);
    // The long one finishes, the short one is still running: exactly one bell.
    rerender(<Probe activeTools={[{ ...first, isRunning: false }, second]} />);
    unmount();

    expect(bells).toHaveLength(1);
  });

  it('writes nothing at all when the mode is off', () => {
    function OffProbe({ activeTools }: { activeTools: readonly IToolState[] }): React.ReactElement {
      useScreenReaderTurnSignals({
        enabled: false,
        isThinking: true,
        activeTools,
        awaitingAnswer: false,
      });
      return <></>;
    }
    const { rerender, unmount } = render(<OffProbe activeTools={[tool()]} />);
    vi.advanceTimersByTime(LONG_TOOL_BELL_MS + 1000);
    rerender(<OffProbe activeTools={[tool({ isRunning: false })]} />);
    unmount();

    expect(bells).toEqual([]);
  });
});
