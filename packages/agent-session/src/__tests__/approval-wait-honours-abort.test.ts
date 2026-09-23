import { describe, expect, it, vi } from 'vitest';
import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { PermissionEnforcer } from '../permission-enforcer.js';
import { Session } from '../session.js';

import type {
  IPermissionEnforcerOptions,
  TPermissionHandler,
  TPermissionResult,
} from '../permission-types.js';
import type { IToolWithEventService, ITerminalOutput, TToolArgs } from '@robota-sdk/agent-core';

/**
 * RUNTIME-005 — `abort()` reaches the provider but not the wait.
 *
 * `promptForApproval` awaits a consumer-supplied handler with no signal and no timeout, so a turn
 * parked on a human-approval prompt runs until that prompt resolves on its own — which, for a prompt
 * nobody answers, is never. Since RUNTIME-003 the session's claim is held until the turn unwinds
 * (correctly), so the consequence is a permanently busy session the caller cannot clear except by
 * discarding it.
 *
 * The compensating guard lives one layer up: `agent-framework` drains its prompt registry before
 * calling `session.abort()`. A direct `agent-session` consumer has no equivalent — the
 * guard-above-the-library shape RUNTIME-003 was filed to remove.
 *
 * Every case here RACES against a timer and asserts on the raced outcome. Asserting by letting the
 * suite time out would prove only that something was slow, and would take the timeout with it.
 */
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

function makeEnforcer(overrides: Partial<IPermissionEnforcerOptions> = {}): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'runtime-005',
    cwd: '/tmp',
    getPermissionMode: () => 'default',
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeNoopTerminal(),
    ...overrides,
  });
}

const ARGS: TToolArgs = { command: 'rm -rf /' };

/** Settle or say it did not — never hang the suite to make a point about hanging. */
async function within<T>(promise: Promise<T>, ms = 200): Promise<'settled' | 'pending'> {
  let timer: ReturnType<typeof setTimeout>;
  const pending = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms);
  });
  try {
    return await Promise.race([promise.then(() => 'settled' as const), pending]);
  } finally {
    clearTimeout(timer!);
  }
}

describe('an approval prompt observes the turn abort (RUNTIME-005)', () => {
  it('a prompt nobody answers is released when the turn aborts', async () => {
    const controller = new AbortController();
    const enforcer = makeEnforcer({
      // The shape of a real prompt: it resolves when a human answers, and nobody does.
      permissionHandler: () => new Promise<TPermissionResult>(() => undefined),
    });

    const decision = enforcer.checkPermission('Bash', ARGS, controller.signal);
    controller.abort();

    // Against the defect this is 'pending' forever, and the session stays claimed.
    expect(await within(decision)).toBe('settled');
  });

  it('the released prompt DENIES rather than allowing', async () => {
    // Fail-closed is the whole point: a cancelled approval must never read as approval, or aborting
    // a turn becomes a way to run an unapproved tool.
    const controller = new AbortController();
    const enforcer = makeEnforcer({
      permissionHandler: () => new Promise<TPermissionResult>(() => undefined),
    });

    const decision = enforcer.checkPermission('Bash', ARGS, controller.signal);
    controller.abort();

    // Raced, not awaited outright: against the defect an unraced await takes the suite timeout with
    // it, which proves only that something was slow. The task asks for a raced outcome for exactly
    // this reason.
    expect(await within(decision.then((allowed) => (allowed ? 'allowed' : 'denied')))).toBe(
      'settled',
    );
    await expect(decision).resolves.toBe(false);
  });

  it('an ALREADY aborted signal does not prompt at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const handler = vi.fn<TPermissionHandler>();
    const enforcer = makeEnforcer({ permissionHandler: handler });

    await expect(enforcer.checkPermission('Bash', ARGS, controller.signal)).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a prompt that IS answered still decides normally', async () => {
    // The signal must not turn every approval into a denial — that would be a different bug wearing
    // this fix's clothes.
    const controller = new AbortController();
    const enforcer = makeEnforcer({
      permissionHandler: vi.fn<TPermissionHandler>().mockResolvedValue(true),
    });

    await expect(enforcer.checkPermission('Bash', ARGS, controller.signal)).resolves.toBe(true);
  });

  it('works with no signal at all — the parameter is optional', async () => {
    const enforcer = makeEnforcer({
      permissionHandler: vi.fn<TPermissionHandler>().mockResolvedValue(true),
    });
    await expect(enforcer.checkPermission('Bash', ARGS)).resolves.toBe(true);
  });

  it('the injected approval fn is released the same way', async () => {
    // Two waits, one contract: `promptForApprovalFn` is the other path into the same prompt.
    const controller = new AbortController();
    const enforcer = makeEnforcer({
      promptForApprovalFn: () => new Promise<TPermissionResult>(() => undefined),
    });

    const decision = enforcer.checkPermission('Bash', ARGS, controller.signal);
    controller.abort();

    expect(await within(decision)).toBe('settled');
    await expect(decision).resolves.toBe(false);
  });
});

/**
 * Through the wrapper, which is how a real turn reaches the prompt.
 *
 * `checkPermission` taking a signal is only half the fix: the signal has to arrive. It reaches the
 * tool wrapper as `context.signal` (CORE-018) and stopped there, so wiring only the enforcer would
 * have left the defect exactly as it was — the shape this session has hit repeatedly.
 */
describe('the turn signal reaches the prompt through the tool wrapper (RUNTIME-005)', () => {
  function makeTool(): IToolWithEventService {
    return {
      getName: () => 'Bash',
      execute: vi.fn().mockResolvedValue({ success: true, data: 'ran' }),
    } as unknown as IToolWithEventService;
  }

  it('an aborted turn releases a tool parked on approval, and does NOT run it', async () => {
    const controller = new AbortController();
    const enforcer = makeEnforcer({
      permissionHandler: () => new Promise<TPermissionResult>(() => undefined),
    });
    const tool = makeTool();
    const [wrapped] = enforcer.wrapTools([tool]);

    const execution = wrapped!.execute(ARGS as never, {
      toolName: 'Bash',
      parameters: ARGS as never,
      signal: controller.signal,
    });
    controller.abort();

    // Against the defect this never settles and the session stays claimed.
    expect(await within(execution)).toBe('settled');
    // Fail-closed all the way through: the tool itself must not have run.
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('an approved tool still runs — the signal did not turn every call into a denial', async () => {
    const enforcer = makeEnforcer({
      permissionHandler: vi.fn<TPermissionHandler>().mockResolvedValue(true),
    });
    const tool = makeTool();
    const [wrapped] = enforcer.wrapTools([tool]);

    await wrapped!.execute(ARGS as never, {
      toolName: 'Bash',
      parameters: ARGS as never,
      signal: new AbortController().signal,
    });
    expect(tool.execute).toHaveBeenCalled();
  });
});

describe('Session abort releases a turn parked on approval (RUNTIME-005)', () => {
  it('rejects the real run, releases its claim, and never invokes the unapproved tool', async () => {
    let markApprovalEntered!: () => void;
    const approvalEntered = new Promise<void>((resolve) => {
      markApprovalEntered = resolve;
    });
    const executeTool = vi.fn().mockResolvedValue('should not run');
    const tool = new FunctionTool(
      {
        name: 'DestructiveAction',
        description: 'permission-gated test tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      executeTool,
    );
    const { provider } = createScriptedProvider([
      { toolCalls: [{ name: 'DestructiveAction', args: {} }] },
      { text: 'tool was denied' },
    ]);
    const session = new Session({
      cwd: process.cwd(),
      tools: [tool],
      provider,
      systemMessage: 'test',
      terminal: makeNoopTerminal(),
      permissionHandler: () => {
        markApprovalEntered();
        return new Promise<TPermissionResult>(() => undefined);
      },
    });

    const run = session.run('use the tool');
    await approvalEntered;
    expect(session.isRunning()).toBe(true);

    session.abort();
    const outcome = await Promise.race([
      run.then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      ),
      new Promise<{ status: 'pending' }>((resolve) =>
        setTimeout(() => resolve({ status: 'pending' }), 250),
      ),
    ]);

    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).name).toBe('AbortError');
    }
    expect(session.isRunning()).toBe(false);
    expect(executeTool).not.toHaveBeenCalled();
  });
});
