/**
 * FLOW-004 (monitor): the line→wake matcher turns matching process output lines into
 * agent-wake instructions, buffers partial lines across chunks, and coalesces bursts.
 */

import { describe, expect, it } from 'vitest';

import { createLineWakeMatcher } from '../line-wake-matcher.js';

describe('createLineWakeMatcher (FLOW-004)', () => {
  it('TC-01: a matching line emits a wake whose instruction includes the matched line', () => {
    const wakes: string[] = [];
    const matcher = createLineWakeMatcher({
      matchPattern: 'ERROR',
      agentInstruction: 'investigate the failure',
      emit: (instruction) => wakes.push(instruction),
    });

    matcher.push('starting up\nERROR: build failed\n');

    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toContain('investigate the failure');
    expect(wakes[0]).toContain('ERROR: build failed');
  });

  it('TC-02: non-matching output produces no wake', () => {
    const wakes: string[] = [];
    const matcher = createLineWakeMatcher({
      matchPattern: 'ERROR',
      agentInstruction: 'x',
      emit: (instruction) => wakes.push(instruction),
    });

    matcher.push('all good\ncompiled successfully\n');

    expect(wakes).toHaveLength(0);
  });

  it('TC-02b: an incomplete line is buffered until its newline arrives', () => {
    const wakes: string[] = [];
    const matcher = createLineWakeMatcher({
      matchPattern: 'ERROR',
      agentInstruction: 'x',
      emit: (instruction) => wakes.push(instruction),
    });

    matcher.push('ER'); // partial — no newline
    expect(wakes).toHaveLength(0);
    matcher.push('ROR: boom\n'); // completes the line
    expect(wakes).toHaveLength(1);
  });

  it('TC-03: a burst of matching lines coalesces within the cooldown window', () => {
    const wakes: string[] = [];
    let clock = 1_000;
    const matcher = createLineWakeMatcher({
      matchPattern: 'ERROR',
      agentInstruction: 'x',
      cooldownMs: 1_000,
      now: () => clock,
      emit: (instruction) => wakes.push(instruction),
    });

    // Three matches within the same instant — only the first emits.
    matcher.push('ERROR 1\nERROR 2\nERROR 3\n');
    expect(wakes).toHaveLength(1);

    // After the cooldown elapses, a new match emits again.
    clock += 1_000;
    matcher.push('ERROR 4\n');
    expect(wakes).toHaveLength(2);
  });
});
