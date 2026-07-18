/**
 * SELFHOST-009 TC-02 — the PreToolUse security gate blocks a tool functionally, via the EXISTING
 * runPreToolHook → blocked path (not re-wired by this spec).
 *
 * A PreToolUse hook returning exit-code-2 (or hookSpecificOutput.permissionDecision: "deny") causes
 * the wrapped tool to return the denial IToolResult; the tool's underlying execute() is never called.
 */

import { describe, it, expect, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type {
  IHookResult,
  IHookTypeExecutor,
  IToolResult,
  IToolWithEventService,
  ITerminalOutput,
  THooksConfig,
} from '@robota-sdk/agent-core';

function makeNoopTerminal(): ITerminalOutput {
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

function makeTool(name: string, execute: () => Promise<IToolResult>): IToolWithEventService {
  return {
    getName: () => name,
    execute: vi.fn(execute),
    setEventService: vi.fn(),
  } as unknown as IToolWithEventService;
}

/** A PreToolUse hook executor that denies via the given mechanism. */
function makeDenyExecutor(mode: 'exit2' | 'json-deny'): IHookTypeExecutor {
  return {
    type: 'command',
    execute: vi.fn(async (): Promise<IHookResult> => {
      if (mode === 'exit2') {
        return { exitCode: 2, stdout: '', stderr: 'Denied: dangerous tool' };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: { permissionDecision: 'deny' },
        }),
        stderr: '',
      };
    }),
  };
}

function denyHooksConfig(): THooksConfig {
  return {
    PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'gate' }] }],
  };
}

function makeEnforcer(executor: IHookTypeExecutor): PermissionEnforcer {
  const options: IPermissionEnforcerOptions = {
    sessionId: 'test-session',
    cwd: '/tmp',
    getPermissionMode: () => 'bypassPermissions',
    config: { permissions: { allow: [], deny: [] }, hooks: denyHooksConfig() },
    terminal: makeNoopTerminal(),
    hookTypeExecutors: [executor],
  };
  return new PermissionEnforcer(options);
}

describe('SELFHOST-009 TC-02 — PreToolUse security gate (functional)', () => {
  it('exit-code-2 hook blocks the tool: execute is never called, denial returned', async () => {
    const underlying = vi.fn(
      async (): Promise<IToolResult> => ({ success: true, data: 'ran', metadata: {} }),
    );
    const enforcer = makeEnforcer(makeDenyExecutor('exit2'));
    const [wrapped] = enforcer.wrapTools([makeTool('Bash', underlying)]);

    const result = await wrapped!.execute({ command: 'rm -rf /' });

    expect(underlying).not.toHaveBeenCalled();
    const data = JSON.parse(result.data as string) as Record<string, unknown>;
    expect(data['blocked']).toBe(true);
    expect(String(data['reason'])).toContain('Denied: dangerous tool');
  });

  it('permissionDecision:"deny" hook blocks the tool the same way', async () => {
    const underlying = vi.fn(
      async (): Promise<IToolResult> => ({ success: true, data: 'ran', metadata: {} }),
    );
    const enforcer = makeEnforcer(makeDenyExecutor('json-deny'));
    const [wrapped] = enforcer.wrapTools([makeTool('Write', underlying)]);

    const result = await wrapped!.execute({ path: '/etc/passwd', content: 'x' });

    expect(underlying).not.toHaveBeenCalled();
    const data = JSON.parse(result.data as string) as Record<string, unknown>;
    expect(data['blocked']).toBe(true);
  });

  it('a passing (exit 0) PreToolUse hook lets the tool run', async () => {
    const underlying = vi.fn(
      async (): Promise<IToolResult> => ({ success: true, data: 'ran', metadata: {} }),
    );
    const passExecutor: IHookTypeExecutor = {
      type: 'command',
      execute: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    };
    const enforcer = makeEnforcer(passExecutor);
    const [wrapped] = enforcer.wrapTools([makeTool('Read', underlying)]);

    const result = await wrapped!.execute({ path: '/x' });

    expect(underlying).toHaveBeenCalledOnce();
    expect(result.data).toBe('ran');
  });
});
