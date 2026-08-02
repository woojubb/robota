import { describe, expect, it, vi } from 'vitest';

import { Session } from '../session.js';

/**
 * ARCH-010 — the session's execution root is a required field, and required is enforced at RUNTIME.
 *
 * `Session` used to read `process.cwd()` in its constructor. That ambient value became the session's
 * identity everywhere it matters — every hook input, `CLAUDE_PROJECT_DIR`, the permission enforcer's
 * root, the persisted record — so a subagent ran in its parent's directory rather than its own
 * workspace, while the subagent spawn contract had declared `cwd` required all along.
 *
 * Making it a required TypeScript field is necessary and not sufficient. This package's tsconfig
 * EXCLUDES `*.test.ts`, and a JavaScript consumer is not type-checked at all — so without a runtime
 * check the field would simply be `undefined`, and the session would report a root it does not have
 * while everything downstream quietly used nothing. That is the silent shape the whole task is about.
 */
const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn().mockResolvedValue(''),
  select: vi.fn().mockResolvedValue(0),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
};

const PROVIDER = {
  name: 'test-provider',
  version: '1.0.0',
  chat: vi.fn(),
  supportsTools: () => true,
  validateConfig: () => true,
};

/** The shape a JS consumer or an untypechecked test actually passes. */
function construct(cwd: unknown): () => Session {
  return () =>
    new Session({
      tools: [] as never,
      provider: PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      cwd,
    } as never);
}

describe('a session must be told where it runs (ARCH-010)', () => {
  it('REFUSES to construct with no execution root', () => {
    expect(construct(undefined)).toThrow(/requires `cwd`/i);
  });

  it('refuses an empty string — a root of "" is not a root', () => {
    expect(construct('')).toThrow(/requires `cwd`/i);
  });

  it('refuses a non-string, which is what a JS caller passing the wrong thing supplies', () => {
    expect(construct(123)).toThrow(/requires `cwd`/i);
  });

  it('names what the value is FOR, so the caller can tell whether process.cwd() is right', () => {
    // An error that only says "cwd is required" gets `process.cwd()` pasted in reflexively, which is
    // the ambient read this change removed. Saying what consumes it makes that a decision.
    expect(construct(undefined)).toThrow(/hook input|CLAUDE_PROJECT_DIR|permission root/i);
  });

  it('constructs, and reports the root it was given', () => {
    const session = new Session({
      tools: [] as never,
      provider: PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      cwd: '/tmp/some-workspace',
    });
    // `getCwd()` exists so a fork or subagent asks the session instead of re-deriving a root that
    // can disagree with it.
    expect(session.getCwd()).toBe('/tmp/some-workspace');
  });
});
