/**
 * Issue #2429 — a relative `filePath` reaches the permission gate resolved against the session root,
 * so an absolute pattern can judge it, and the tool receives the same canonical path.
 *
 * Before: `Read(/root/secrets/**)` in `deny` against `secrets/key` was UNEVALUABLE (CORE-049 refuses
 * to guess the base) — a prompt, not a deny — while the tool went on to open `<cwd>/secrets/key`.
 */
import { registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { describe, it, expect, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';
import { canonicaliseToolArguments } from '../tool-argument-canonicalisation.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

const ROOT = '/work/project';

registerToolPermissionProfile('Read', {
  argument: { key: 'filePath', kind: 'path' },
  riskClass: 'inspect',
});
registerToolPermissionProfile('Grep', {
  argument: { key: 'pattern', kind: 'text' },
  riskClass: 'inspect',
});

function makeTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function makeEnforcer(overrides: Partial<IPermissionEnforcerOptions> = {}): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: ROOT,
    getPermissionMode: () => 'default',
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeTerminal(),
    ...overrides,
  });
}

function makeTool(name: string, execute: (args: unknown) => Promise<unknown>) {
  return {
    getName: () => name,
    name,
    description: `${name} for a test`,
    parameters: { type: 'object' as const, properties: {} },
    execute: execute as never,
    setEventService: vi.fn(),
  } as never;
}

describe('canonicaliseToolArguments', () => {
  it('resolves a relative path-kind argument against the session root', () => {
    expect(canonicaliseToolArguments('Read', { filePath: 'src/x.ts' }, ROOT)).toEqual({
      filePath: `${ROOT}/src/x.ts`,
    });
    expect(canonicaliseToolArguments('Read', { filePath: '../up.ts' }, ROOT)).toEqual({
      filePath: '/work/up.ts',
    });
  });

  it('leaves an absolute path, a non-path kind and an unprofiled tool untouched', () => {
    const absolute = { filePath: '/elsewhere/x.ts' };
    expect(canonicaliseToolArguments('Read', absolute, ROOT)).toBe(absolute);
    const text = { pattern: 'src/**' };
    expect(canonicaliseToolArguments('Grep', text, ROOT)).toBe(text);
    const unknown = { filePath: 'src/x.ts' };
    expect(canonicaliseToolArguments('NoSuchTool', unknown, ROOT)).toBe(unknown);
  });
});

describe('the wrapper canonicalises before the gate and the tool (issue #2429)', () => {
  it('an absolute deny pattern denies a relative path that resolves under it', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: 'leaked' });
    const promptForApprovalFn = vi.fn().mockResolvedValue('allow-once');
    const enforcer = makeEnforcer({
      config: { permissions: { allow: [], deny: [`Read(${ROOT}/secrets/**)`] } },
      promptForApprovalFn,
    });
    const [wrapped] = enforcer.wrapTools([makeTool('Read', execute)]);

    const result = (await wrapped.execute({ filePath: 'secrets/key' }, undefined as never)) as {
      success: boolean;
    };

    expect(result.success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    // Denied outright — not the "unevaluable, so ask" route the relative form used to take.
    expect(promptForApprovalFn).not.toHaveBeenCalled();
  });

  it('the tool receives the resolved path, not the relative one', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: 'ok' });
    const enforcer = makeEnforcer({
      config: { permissions: { allow: [`Read(${ROOT}/**)`], deny: [] } },
    });
    const [wrapped] = enforcer.wrapTools([makeTool('Read', execute)]);

    await wrapped.execute({ filePath: 'src/x.ts' }, undefined as never);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ filePath: `${ROOT}/src/x.ts` });
  });
});
