/**
 * A PreToolUse hook's `permissionDecision` and `updatedInput` reach the permission gate: `allow`
 * answers the ordinary prompt, `ask` reaches a person whatever the mode allows, `defer` leaves the
 * normal flow, and the rules, the prompt and the tool see the rewritten input.
 */

import { clearRegisteredToolProfiles, registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions, TPermissionHandler } from '../permission-types.js';
import type {
  IHookTypeExecutor,
  IToolResult,
  IToolWithEventService,
  ITerminalOutput,
  TPermissionMode,
  TToolParameters,
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

/** A command hook that answers with the given `hookSpecificOutput`. */
function hookSaying(specific: Record<string, unknown>): IHookTypeExecutor {
  return {
    type: 'command',
    execute: vi.fn(async () => ({
      outcome: 'allow' as const,
      source: 'command' as const,
      stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...specific } }),
    })),
  };
}

function setup(
  specific: Record<string, unknown>,
  options: {
    mode?: TPermissionMode;
    allow?: string[];
    deny?: string[];
    ask?: string[];
    handler?: TPermissionHandler;
  } = {},
): {
  enforcer: PermissionEnforcer;
  run: (parameters: TToolParameters) => Promise<IToolResult>;
  body: ReturnType<typeof vi.fn>;
} {
  const config: IPermissionEnforcerOptions['config'] = {
    permissions: {
      allow: options.allow ?? [],
      deny: options.deny ?? [],
      ...(options.ask ? { ask: options.ask } : {}),
    },
    hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'gate' }] }] },
  };
  const enforcer = new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/tmp',
    getPermissionMode: () => options.mode ?? 'default',
    config,
    terminal: makeNoopTerminal(),
    hookTypeExecutors: [hookSaying(specific)],
    ...(options.handler ? { permissionHandler: options.handler } : {}),
  });
  const body = vi.fn(async (parameters: TToolParameters): Promise<IToolResult> => ({
    success: true,
    data: `ran ${String(parameters['command'])}`,
    metadata: {},
  }));
  const tool = {
    getName: () => 'Bash',
    execute: body,
    setEventService: vi.fn(),
  } as unknown as IToolWithEventService;
  const [wrapped] = enforcer.wrapTools([tool]);
  const run = (parameters: TToolParameters): Promise<IToolResult> =>
    wrapped!.execute(parameters, { toolName: 'Bash', parameters });
  return { enforcer, run, body };
}

beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
});

afterEach(() => clearRegisteredToolProfiles());

describe('PreToolUse permissionDecision', () => {
  it('allow answers the prompt a call would otherwise need', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(false);
    const { run, body } = setup({ permissionDecision: 'allow' }, { handler });

    const result = await run({ command: 'pnpm test' });

    expect(handler).not.toHaveBeenCalled();
    expect(body).toHaveBeenCalledOnce();
    expect(result.data).toBe('ran pnpm test');
  });

  it('allow does not outweigh a deny rule', async () => {
    const { run, body } = setup({ permissionDecision: 'allow' }, { deny: ['Bash(pnpm *)'] });

    await run({ command: 'pnpm test' });

    expect(body).not.toHaveBeenCalled();
  });

  it('allow does not answer an ask rule, which must reach a person', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(false);
    const { run, body } = setup(
      { permissionDecision: 'allow' },
      { ask: ['Bash(pnpm *)'], handler },
    );

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('ask reaches a person even in a mode that would run the call unasked', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(false);
    const { run, body } = setup(
      { permissionDecision: 'ask' },
      { mode: 'bypassPermissions', handler },
    );

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('ask is not answered by a consent remembered for the session', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue('allow-session');
    const { run, body } = setup({ permissionDecision: 'ask' }, { handler });

    await run({ command: 'pnpm test' });
    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(body).toHaveBeenCalledTimes(2);
  });

  it('defer leaves the call to the normal flow', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(false);
    const { run, body } = setup({ permissionDecision: 'defer' }, { handler });

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });
});

describe('PreToolUse updatedInput', () => {
  it('the tool runs the rewritten input', async () => {
    const { run, body } = setup(
      { permissionDecision: 'allow', updatedInput: { command: 'pnpm test --run' } },
      { mode: 'bypassPermissions' },
    );

    const result = await run({ command: 'pnpm test' });

    expect(body).toHaveBeenCalledOnce();
    expect(body.mock.calls[0]![0]).toEqual({ command: 'pnpm test --run' });
    expect(result.data).toBe('ran pnpm test --run');
  });

  it('the rules judge the rewritten input, not the one the model sent', async () => {
    // A person would approve the call the model sent; the rewrite is what the deny rule matches.
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(true);
    const { run, body } = setup(
      { permissionDecision: 'allow', updatedInput: { command: 'rm -rf build' } },
      { deny: ['Bash(rm *)'], handler },
    );

    await run({ command: 'pnpm test' });

    expect(body).not.toHaveBeenCalled();
  });

  it('an updatedInput that is not an object refuses the call', async () => {
    const { run, body } = setup(
      { permissionDecision: 'allow', updatedInput: 'pnpm test' },
      { mode: 'bypassPermissions' },
    );

    const result = await run({ command: 'pnpm test' });

    expect(body).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('a rewrite of arguments the tool already fixed at admission refuses the call', async () => {
    const hooks = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'command' as const, command: 'gate' }] }],
    };
    const enforcer = new PermissionEnforcer({
      sessionId: 'test-session',
      cwd: '/tmp',
      getPermissionMode: () => 'bypassPermissions',
      config: { permissions: { allow: [], deny: [] }, hooks },
      terminal: makeNoopTerminal(),
      hookTypeExecutors: [
        hookSaying({ permissionDecision: 'allow', updatedInput: { command: 'pnpm test --run' } }),
      ],
    });
    const effect = vi.fn();
    const tool = {
      getName: () => 'Bash',
      execute: vi.fn(),
      // The tool settles on other arguments before its effect, so the hooks run again on them.
      executeWithAdmission: async (
        _parameters: TToolParameters,
        _context: unknown,
        admit: (effective: TToolParameters) => Promise<void>,
      ): Promise<IToolResult> => {
        await admit({ command: 'pnpm build' });
        effect();
        return { success: true, data: 'built', metadata: {} };
      },
      setEventService: vi.fn(),
    } as unknown as IToolWithEventService;
    const [wrapped] = enforcer.wrapTools([tool]);

    const result = await wrapped!.executeWithAdmission!(
      { command: 'pnpm test' },
      { toolName: 'Bash', parameters: { command: 'pnpm test' } },
      async () => undefined,
    );

    expect(effect).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('a delegated action cannot take a rewrite, so the rewrite refuses it', async () => {
    const { enforcer } = setup(
      { permissionDecision: 'allow', updatedInput: { command: 'pnpm test --run' } },
      { mode: 'bypassPermissions' },
    );

    expect(await enforcer.checkDelegatedToolCall('Bash', { command: 'pnpm test' })).toBe(false);
  });

  it('a delegated action takes the allow', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(false);
    const { enforcer } = setup({ permissionDecision: 'allow' }, { handler });

    expect(await enforcer.checkDelegatedToolCall('Bash', { command: 'pnpm test' })).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
