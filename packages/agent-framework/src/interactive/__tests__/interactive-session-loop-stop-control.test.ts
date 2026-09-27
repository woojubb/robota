/**
 * #3288 §1: `/loop stop <id>` is a mid-turn CONTROL action, like `/goal cancel` (#3280 §2) — it must
 * reach the loop command while a turn is still running, since a runaway loop is exactly when
 * stopping it matters. Unlike `/goal cancel`, it does NOT abort the running turn: stopping a loop
 * only stops its FUTURE iterations (`stopSelfPacedLoop`/`cancelBackgroundTask` already let an
 * already-running turn finish), so this test only proves the base class's mid-turn gate is bypassed,
 * never that the turn is torn down.
 *
 * The `/loop` command's own semantics (routing to `stopSelfPacedLoop` / `cancelBackgroundTask`, the
 * `/loop` confirmation flow) are exercised in `agent-command`'s `loop-command.test.ts`; this file
 * only tests the framework-level bypass with a stub command module, decoupled from that package.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { ICommandModule, ICommandResult } from '../../commands/index.js';
import type { SessionExecutionController } from '../interactive-session-execution-controller.js';

function createRuntimeSession(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getSessionId: () => 'session_loop_stop',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

function createSession(
  execute: (context: never, args: string) => Promise<ICommandResult> | ICommandResult,
): InteractiveSession {
  const modules: ICommandModule[] = [
    {
      name: 'test-loop-module',
      systemCommands: [
        {
          name: 'loop',
          description: 'test loop',
          requiresPermission: false,
          lifecycle: 'inline',
          execute,
        },
      ],
    },
  ];
  return new InteractiveSession({ session: createRuntimeSession() as never, commandModules: modules });
}

function getExecCtrl(session: InteractiveSession): SessionExecutionController {
  return (session as unknown as { execCtrl: SessionExecutionController }).execCtrl;
}

function holdExecution(execCtrl: SessionExecutionController): void {
  void execCtrl.executeForegroundCommand(
    () => new Promise<ICommandResult>(() => {}),
    () => Promise.resolve(),
  );
}

describe('InteractiveSession /loop stop as a mid-turn control action (#3288 §1)', () => {
  it('reaches the loop command while a turn is running, and leaves the turn running', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, message: 'Loop stopped: loop_x.' });
    const session = createSession(execute);
    const execCtrl = getExecCtrl(session);
    holdExecution(execCtrl);
    expect(execCtrl.executing).toBe(true);

    const result = await session.executeCommand('loop', 'stop loop_x');

    expect(result).toMatchObject({ success: true, message: 'Loop stopped: loop_x.' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1]).toBe('stop loop_x');
    // Unlike /goal cancel, the running turn is left alone — no abort.
    expect(execCtrl.executing).toBe(true);
  });

  it('an ordinary /loop invocation (no "stop") keeps the mid-turn refusal', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
    const session = createSession(execute);
    holdExecution(getExecCtrl(session));

    const result = await session.executeCommand('loop', 'list');

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('Another prompt or command is already running'),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('"/loop stopwatch..." (a prompt that merely starts with "stop") keeps the mid-turn refusal', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
    const session = createSession(execute);
    holdExecution(getExecCtrl(session));

    const result = await session.executeCommand('loop', 'stopwatch the build every 2 minutes');

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('Another prompt or command is already running'),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('/loop stop with no turn running behaves like an ordinary command', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
    const session = createSession(execute);

    const result = await session.executeCommand('loop', 'stop loop_x');

    expect(result).toMatchObject({ success: true, message: 'ok' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
