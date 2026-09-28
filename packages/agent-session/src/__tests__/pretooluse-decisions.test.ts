/**
 * A PreToolUse command hook's `permissionDecision` reaches the permission gate: `allow` answers the
 * person's prompt, `ask` reaches a person whatever the mode allows, and `defer` leaves the normal
 * flow. A model-judged hook can only refuse, and an `allow` sent with a rewrite is not applied.
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
  THooksConfig,
  TPermissionMode,
  TToolParameters,
} from '@robota-sdk/agent-core';

beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
});

afterEach(() => clearRegisteredToolProfiles());

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

function bodyOf(specific: Record<string, unknown>): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...specific } });
}

/**
 * Command hooks, one per answer. Each hook's `command` names the answer it gives, so several hooks
 * share the one command executor.
 */
function commandHooks(...answers: Record<string, unknown>[]): {
  hooks: THooksConfig;
  executors: IHookTypeExecutor[];
} {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: '',
          hooks: answers.map((_, index) => ({ type: 'command' as const, command: `${index}` })),
        },
      ],
    },
    executors: [
      {
        type: 'command',
        execute: vi.fn(async (definition) => ({
          outcome: 'allow' as const,
          source: 'command' as const,
          stdout: bodyOf(answers[Number((definition as { command: string }).command)]!),
        })),
      },
    ],
  };
}

interface ISetupOptions {
  mode?: TPermissionMode;
  deny?: string[];
  ask?: string[];
  handler?: TPermissionHandler;
  extra?: Partial<IPermissionEnforcerOptions>;
}

function setup(
  hookSetup: { hooks: THooksConfig; executors: IHookTypeExecutor[] },
  options: ISetupOptions = {},
): {
  enforcer: PermissionEnforcer;
  run: (parameters: TToolParameters) => Promise<IToolResult>;
  body: ReturnType<typeof vi.fn>;
} {
  const enforcer = new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/tmp',
    getPermissionMode: () => options.mode ?? 'default',
    config: {
      permissions: {
        allow: [],
        deny: options.deny ?? [],
        ...(options.ask ? { ask: options.ask } : {}),
      },
      hooks: hookSetup.hooks,
    },
    terminal: makeNoopTerminal(),
    hookTypeExecutors: hookSetup.executors,
    ...(options.handler ? { permissionHandler: options.handler } : {}),
    ...options.extra,
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

const refuse = (): TPermissionHandler => vi.fn<TPermissionHandler>().mockResolvedValue(false);

describe('a command hook’s permissionDecision', () => {
  it('allow answers the prompt a call would otherwise need', async () => {
    const handler = refuse();
    const { run, body } = setup(commandHooks({ permissionDecision: 'allow' }), { handler });

    const result = await run({ command: 'pnpm test' });

    expect(handler).not.toHaveBeenCalled();
    expect(body).toHaveBeenCalledOnce();
    expect(result.data).toBe('ran pnpm test');
  });

  it('allow does not outweigh a deny rule', async () => {
    const { run, body } = setup(commandHooks({ permissionDecision: 'allow' }), {
      deny: ['Bash(pnpm *)'],
    });

    await run({ command: 'pnpm test' });

    expect(body).not.toHaveBeenCalled();
  });

  it('allow does not answer an ask rule, which must reach a person', async () => {
    const handler = refuse();
    const { run, body } = setup(commandHooks({ permissionDecision: 'allow' }), {
      ask: ['Bash(pnpm *)'],
      handler,
    });

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('allow does not answer a policy that asks about everything', async () => {
    const handler = refuse();
    const { run, body } = setup(commandHooks({ permissionDecision: 'allow' }), {
      mode: 'bypassPermissions',
      handler,
      extra: { permissionPolicy: 'prompt' },
    });

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('allow does not stand in for the auto-mode classifier', async () => {
    const classify = vi.fn().mockResolvedValue({ decision: 'block', reason: 'not this one' });
    const { run, body } = setup(commandHooks({ permissionDecision: 'allow' }), {
      mode: 'auto',
      extra: { permissionClassifier: { classify } },
    });

    await run({ command: 'pnpm test' });

    expect(classify).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('ask reaches a person even in a mode that would run the call unasked', async () => {
    const handler = refuse();
    const { run, body } = setup(commandHooks({ permissionDecision: 'ask' }), {
      mode: 'bypassPermissions',
      handler,
    });

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('ask is not answered by a consent remembered for the session', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue('allow-session');
    const { run, body } = setup(commandHooks({ permissionDecision: 'ask' }), { handler });

    await run({ command: 'pnpm test' });
    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(body).toHaveBeenCalledTimes(2);
  });

  it('defer leaves the call to the normal flow', async () => {
    const handler = refuse();
    const { run, body } = setup(commandHooks({ permissionDecision: 'defer' }), { handler });

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('another hook’s defer does not cancel an ask', async () => {
    const handler = refuse();
    const { run, body } = setup(
      commandHooks({ permissionDecision: 'ask' }, { permissionDecision: 'defer' }),
      { mode: 'bypassPermissions', handler },
    );

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('an allow sent with an updatedInput is not applied, and the call runs its own input', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(true);
    const { run, body } = setup(
      commandHooks({ permissionDecision: 'allow', updatedInput: { command: 'pnpm test --run' } }),
      { handler },
    );

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body.mock.calls[0]![0]).toEqual({ command: 'pnpm test' });
  });
});

describe('which hooks can steer a call', () => {
  it('a prompt hook’s allow is not applied, since its model reads the input it would approve', async () => {
    const handler = refuse();
    const { run, body } = setup(
      {
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'prompt', prompt: 'judge' }] }],
        },
        executors: [
          {
            type: 'prompt',
            execute: vi.fn(async () => ({
              outcome: 'allow' as const,
              source: 'prompt' as const,
              stdout: JSON.stringify({
                ok: true,
                hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
              }),
            })),
          },
        ],
      },
      { handler },
    );

    await run({ command: 'pnpm test' });

    expect(handler).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });
});

describe('a call the gate checks again or on another’s behalf', () => {
  it('the decision applies to the arguments a tool settles on at admission', async () => {
    const handler = refuse();
    const { hooks, executors } = commandHooks({ permissionDecision: 'allow' });
    const enforcer = new PermissionEnforcer({
      sessionId: 'test-session',
      cwd: '/tmp',
      getPermissionMode: () => 'default',
      config: { permissions: { allow: [], deny: [] }, hooks },
      terminal: makeNoopTerminal(),
      hookTypeExecutors: executors,
      permissionHandler: handler,
    });
    const effect = vi.fn();
    const tool = {
      getName: () => 'Bash',
      execute: vi.fn(),
      // The tool settles on other arguments before its effect, so the gate runs again on them.
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

    await wrapped!.executeWithAdmission!(
      { command: 'pnpm test' },
      { toolName: 'Bash', parameters: { command: 'pnpm test' } },
      async () => undefined,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(effect).toHaveBeenCalledOnce();
  });

  it('a delegated action takes the allow', async () => {
    const handler = refuse();
    const { enforcer } = setup(commandHooks({ permissionDecision: 'allow' }), { handler });

    expect(await enforcer.checkDelegatedToolCall('Bash', { command: 'pnpm test' })).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
