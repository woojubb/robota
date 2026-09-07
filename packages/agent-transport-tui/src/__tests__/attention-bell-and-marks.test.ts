/**
 * CLI-2004 TC-08 / TC-09 — the two writers that reach the terminal outside Ink.
 *
 * Both are asserted against the exact BYTES, because that is the only channel a screen reader has:
 * there is no `aria-live` in a terminal, so what a reader gets is what lands in the buffer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BELL, createAttentionBell, LONG_TOOL_BELL_MS } from '../attention-bell.js';
import { supportsTurnMarks } from '../terminal-capabilities.js';
import { createTurnMarkWriter, turnMarkSequence } from '../terminal-marks.js';

function collector(): { written: string[]; write: (text: string) => void } {
  const written: string[] = [];
  return { written, write: (text: string): void => void written.push(text) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('TC-08: the attention bell', () => {
  it('emits exactly one BEL on reply completion', () => {
    const sink = collector();
    createAttentionBell({ enabled: true, write: sink.write }).replyCompleted();
    expect(sink.written).toEqual([BELL]);
  });

  it('emits exactly one BEL when a prompt mounts', () => {
    const sink = collector();
    createAttentionBell({ enabled: true, write: sink.write }).promptMounted();
    expect(sink.written).toEqual([BELL]);
  });

  it('rings for a tool that outlived LONG_TOOL_BELL_MS', () => {
    const sink = collector();
    let now = 0;
    const bell = createAttentionBell({ enabled: true, write: sink.write, now: () => now });
    bell.toolStarted('Bash#0');
    now = LONG_TOOL_BELL_MS + 1;
    bell.toolCompleted('Bash#0');
    expect(sink.written).toEqual([BELL]);
  });

  it('stays silent for a tool that finished under the threshold', () => {
    const sink = collector();
    let now = 0;
    const bell = createAttentionBell({ enabled: true, write: sink.write, now: () => now });
    bell.toolStarted('Bash#0');
    now = LONG_TOOL_BELL_MS;
    bell.toolCompleted('Bash#0');
    expect(sink.written).toEqual([]);
  });

  it('stays silent for a completion whose start was never recorded', () => {
    const sink = collector();
    const bell = createAttentionBell({ enabled: true, write: sink.write });
    bell.toolCompleted('Bash#0');
    expect(sink.written).toEqual([]);
  });

  it('writes nothing at all when the mode is off', () => {
    const sink = collector();
    let now = 0;
    const bell = createAttentionBell({ enabled: false, write: sink.write, now: () => now });
    bell.replyCompleted();
    bell.promptMounted();
    bell.toolStarted('Bash#0');
    now = LONG_TOOL_BELL_MS * 10;
    bell.toolCompleted('Bash#0');
    expect(sink.written).toEqual([]);
  });
});

describe('TC-09: the OSC 133 turn marks', () => {
  const A = '\x1b]133;A\x07';
  const B = '\x1b]133;B\x07';
  const C = '\x1b]133;C\x07';
  const D = '\x1b]133;D\x07';

  it('emits A, B, C, D in that order across one turn', () => {
    const sink = collector();
    const marks = createTurnMarkWriter({ enabled: true, supported: () => true, write: sink.write });
    marks.emit('promptStart');
    marks.emit('promptEnd');
    marks.emit('turnStart');
    marks.emit('turnEnd');
    expect(sink.written).toEqual([A, B, C, D]);
  });

  it('spells each mark exactly', () => {
    expect(turnMarkSequence('promptStart')).toBe(A);
    expect(turnMarkSequence('promptEnd')).toBe(B);
    expect(turnMarkSequence('turnStart')).toBe(C);
    expect(turnMarkSequence('turnEnd')).toBe(D);
  });

  it('emits nothing when the mode is off', () => {
    const sink = collector();
    const marks = createTurnMarkWriter({ enabled: false, supported: () => true, write: sink.write });
    marks.emit('promptStart');
    marks.emit('turnEnd');
    expect(sink.written).toEqual([]);
  });

  it('emits nothing when supportsTurnMarks() is false', () => {
    const sink = collector();
    const marks = createTurnMarkWriter({ enabled: true, supported: () => false, write: sink.write });
    marks.emit('promptStart');
    marks.emit('turnEnd');
    expect(sink.written).toEqual([]);
  });
});

describe('supportsTurnMarks — the documented negatives', () => {
  it('is off in WezTerm, which owns OSC 133 itself', () => {
    vi.stubEnv('ROBOTA_TURN_MARKS', '');
    vi.stubEnv('TERM_PROGRAM', 'WezTerm');
    expect(supportsTurnMarks()).toBe(false);
  });

  it('honours the explicit opt-in and the kill switch over everything else', () => {
    vi.stubEnv('TERM_PROGRAM', 'WezTerm');
    vi.stubEnv('ROBOTA_TURN_MARKS', '1');
    expect(supportsTurnMarks()).toBe(true);
    vi.stubEnv('ROBOTA_TURN_MARKS', '0');
    expect(supportsTurnMarks()).toBe(false);
  });
});
