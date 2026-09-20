/**
 * SCREEN-2670 TC-07 — the OSC 133 turn marks travel through the owned write path.
 *
 * The marks are positional: the terminal records the line they arrive on. Written to
 * `process.stdout` directly they would land between a parked batch and its release, on the wrong
 * line. So the hook reads the pacing port and writes through it; outside a provider the port is
 * the process's own stdout, which is exactly the pre-change path.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScreenReaderTurnSignals } from '../hooks/useScreenReaderTurnSignals.js';
import { ScreenReaderPacingProvider } from '../screen-reader-pacing-context.js';
import { turnMarkSequence } from '../terminal-marks.js';

import type { IScreenReaderPacingPort } from '../screen-reader-pacing-context.js';

function Probe({ isThinking }: { isThinking: boolean }): React.ReactElement {
  useScreenReaderTurnSignals({ enabled: true, isThinking, activeTools: [], awaitingAnswer: false });
  return <></>;
}

let port: IScreenReaderPacingPort & { writes: string[] };

beforeEach(() => {
  vi.stubEnv('ROBOTA_TURN_MARKS', '1');
  const writes: string[] = [];
  port = {
    writes,
    armEchoRelease: vi.fn(),
    write: (text: string): void => {
      writes.push(text);
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('TC-07: the turn marks go through the port, ordered with the turn they belong to', () => {
  it('emits prompt-start on mount and the B/C pair when a turn starts, all through the port', () => {
    const { rerender } = render(
      <ScreenReaderPacingProvider port={port}>
        <Probe isThinking={false} />
      </ScreenReaderPacingProvider>,
    );
    expect(port.writes).toEqual([turnMarkSequence('promptStart')]);

    rerender(
      <ScreenReaderPacingProvider port={port}>
        <Probe isThinking />
      </ScreenReaderPacingProvider>,
    );
    expect(port.writes).toEqual([
      turnMarkSequence('promptStart'),
      turnMarkSequence('promptEnd'),
      turnMarkSequence('turnStart'),
    ]);
  });

  it('never reaches process.stdout directly while a port is provided', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      render(
        <ScreenReaderPacingProvider port={port}>
          <Probe isThinking={false} />
        </ScreenReaderPacingProvider>,
      );
      const direct = spy.mock.calls.filter((call) => String(call[0]).includes('\x1b]133;'));
      expect(direct).toEqual([]);
      expect(port.writes).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
