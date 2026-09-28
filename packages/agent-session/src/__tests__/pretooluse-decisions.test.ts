/**
 * A PreToolUse command hook's `permissionDecision` reaches the permission gate: `allow` answers the
 * person's prompt, `ask` reaches a person whatever the mode allows, and `defer` leaves the normal
 * flow. A model-judged hook can only refuse; rewritten input must pass every gate again.
 */

import { clearRegisteredToolProfiles, registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions, TPermissionHandler } from '../permission-types.js';
import type {
  IHookTypeExecutor,
  IToolResult,
  IToolWithEventService,
  IToolExecutionContext,
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
  const body = vi.fn(
    async (parameters: TToolParameters, _context: IToolExecutionContext): Promise<IToolResult> => ({
      success: true,
      data: `ran ${String(parameters['command'])}`,
      metadata: {},
    }),
  );
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

  it('applies a stable updatedInput and approves only the input the tool will run', async () => {
    const handler = vi.fn<TPermissionHandler>().mockResolvedValue(true);
    const { run, body } = setup(
      commandHooks({ permissionDecision: 'allow', updatedInput: { command: 'pnpm test --run' } }),
      { handler },
    );

    await run({ command: 'pnpm test' });

    expect(handler).not.toHaveBeenCalled();
    expect(body.mock.calls[0]![0]).toEqual({ command: 'pnpm test --run' });
    expect(body.mock.calls[0]![1].parameters).toEqual({ command: 'pnpm test --run' });
  });

  it('checks deny rules against rewritten input before executing', async () => {
    const { run, body } = setup(
      commandHooks({
        permissionDecision: 'allow',
        updatedInput: { command: 'rm -rf /tmp/fixture' },
      }),
      { deny: ['Bash(rm *)'] },
    );
    expect((await run({ command: 'pnpm test' })).success).toBe(false);
    expect(body).not.toHaveBeenCalled();
  });

  it('runs every other hook against the rewritten input, including an earlier guard', async () => {
    const hooks = commandHooks(
      {},
      { permissionDecision: 'allow', updatedInput: { command: 'danger' } },
    );
    const seen: string[] = [];
    hooks.executors[0]!.execute = async (definition, input) => {
      const command = String(input.tool_input?.command);
      seen.push(command);
      if ((definition as { command: string }).command === '0' && command === 'danger')
        return { outcome: 'deny', source: 'command', reason: 'rewritten input refused' };
      return {
        outcome: 'allow',
        source: 'command',
        stdout: bodyOf(
          (definition as { command: string }).command === '1'
            ? { permissionDecision: 'allow', updatedInput: { command: 'danger' } }
            : {},
        ),
      };
    };
    const { run, body } = setup(hooks);
    expect((await run({ command: 'safe' })).success).toBe(false);
    expect(seen).toContain('danger');
    expect(body).not.toHaveBeenCalled();
  });

  it('refuses rewriting cycles instead of executing an unjudged input', async () => {
    const hooks = commandHooks({});
    hooks.executors[0]!.execute = async (_definition, input) => ({
      outcome: 'allow',
      source: 'command',
      stdout: bodyOf({
        permissionDecision: 'allow',
        updatedInput: { command: input.tool_input?.command === 'a' ? 'b' : 'a' },
      }),
    });
    const { run, body } = setup(hooks);
    const result = await run({ command: 'a' });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/rewrit/i);
    expect(body).not.toHaveBeenCalled();
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
  it.each([false, true])(
    'judges settled arguments and refuses replacing them (rewrite=%s)',
    async (rewrite) => {
      const handler = refuse();
      const { hooks, executors } = commandHooks({ permissionDecision: 'allow' });
      if (rewrite)
        executors[0]!.execute = async (_definition, input) => ({
          outcome: 'allow',
          source: 'command',
          stdout: bodyOf({
            permissionDecision: 'allow',
            ...(input.tool_input?.command !== 'pnpm test'
              ? { updatedInput: { command: 'pnpm other' } }
              : {}),
          }),
        });
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

      const result = await wrapped!.executeWithAdmission!(
        { command: 'pnpm test' },
        { toolName: 'Bash', parameters: { command: 'pnpm test' } },
        async () => undefined,
      );

      expect(handler).not.toHaveBeenCalled();
      expect(result.success).toBe(!rewrite);
      expect(effect).toHaveBeenCalledTimes(rewrite ? 0 : 1);
    },
  );

  it('refuses a delegated action whose arguments a hook tries to replace', async () => {
    const { enforcer } = setup(
      commandHooks({ permissionDecision: 'allow', updatedInput: { command: 'new' } }),
    );
    expect(await enforcer.checkDelegatedToolCall('Bash', { command: 'original' })).toBe(false);
  });

  it('a delegated action takes the allow', async () => {
    const handler = refuse();
    const { enforcer } = setup(commandHooks({ permissionDecision: 'allow' }), { handler });

    expect(await enforcer.checkDelegatedToolCall('Bash', { command: 'pnpm test' })).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
