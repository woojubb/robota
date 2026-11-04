/**
 * How a run's surface and terminal decide whether the startup question is asked, and how a "yes"
 * reaches the session (#3679). The question is written on stderr and answered on stdin, so both must
 * be a terminal: a run whose stderr is redirected would wait on a question nobody sees.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  canAskAtStartup,
  startupResumeInput,
  startupResumeRenderOptions,
} from '../startup-resume-wiring.js';

import type { IStartupAskSurface } from '../startup-resume-wiring.js';

const TERMINAL: IStartupAskSurface = {
  printMode: false,
  goal: false,
  serve: false,
  mcpServe: false,
  acp: false,
  stdinIsTTY: true,
  stdoutIsTTY: true,
  stderrIsTTY: true,
};

describe('whether the startup question can be asked', () => {
  it('asks only the terminal UI with all three streams at a terminal', () => {
    expect(canAskAtStartup(TERMINAL)).toBe(true);
  });

  it.each(['printMode', 'goal', 'serve', 'mcpServe', 'acp'] as const)(
    'never asks under %s, which has no one at a terminal',
    (mode) => {
      expect(canAskAtStartup({ ...TERMINAL, [mode]: true })).toBe(false);
    },
  );

  it.each(['stdinIsTTY', 'stdoutIsTTY', 'stderrIsTTY'] as const)(
    'never asks when %s is false: the question is written on stderr and answered on stdin',
    (stream) => {
      expect(canAskAtStartup({ ...TERMINAL, [stream]: false })).toBe(false);
    },
  );
});

describe('the startup resume input', () => {
  it('carries the request, the decision and the terminal’s answerers', () => {
    const confirm = vi.fn(async () => true);
    const write = vi.fn();

    const input = startupResumeInput({
      store: undefined,
      cwd: '/work',
      request: { continueMode: false, resumeId: 'sess_a', noSessionPersistence: false },
      surface: { ...TERMINAL, stderrIsTTY: false },
      confirm,
      write,
    });

    expect(input).toMatchObject({
      cwd: '/work',
      continueMode: false,
      resumeId: 'sess_a',
      reuseEmptySession: false,
      interactive: false,
    });
    expect(input.confirm).toBe(confirm);
    expect(input.write).toBe(write);
  });

  it('reuses an empty session only for a served launch that persists sessions', () => {
    const served = (noSessionPersistence: boolean) =>
      startupResumeInput({
        store: undefined,
        cwd: '/work',
        request: { continueMode: false, resumeId: undefined, noSessionPersistence },
        surface: { ...TERMINAL, serve: true },
        confirm: async () => false,
        write: () => undefined,
      }).reuseEmptySession;

    expect(served(false)).toBe(true);
    expect(served(true)).toBe(false);
  });
});

describe('what the terminal UI is told of the session it starts in', () => {
  it('hands the session the digest the person accepted, with the id', () => {
    expect(
      startupResumeRenderOptions({
        kind: 'start',
        resumeSessionId: 'sess_a',
        acceptedDigest: 'a'.repeat(64),
      }),
    ).toEqual({
      resumeSessionId: 'sess_a',
      acceptedDigest: 'a'.repeat(64),
      showSessionPickerOnStart: false,
    });
  });

  it('carries no digest when nothing was accepted, and opens the picker when asked', () => {
    expect(startupResumeRenderOptions({ kind: 'start', resumeSessionId: 'sess_a' })).toEqual({
      resumeSessionId: 'sess_a',
      showSessionPickerOnStart: false,
    });
    expect(startupResumeRenderOptions({ kind: 'start', showSessionPicker: true })).toEqual({
      showSessionPickerOnStart: true,
    });
  });
});
