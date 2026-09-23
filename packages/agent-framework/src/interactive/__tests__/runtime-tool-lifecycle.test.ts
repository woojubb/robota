import { describe, expect, it, vi } from 'vitest';
import { InteractiveSessionRuntimeTools } from '../interactive-session-runtime-tools.js';
import { SessionExecutionController } from '../interactive-session-execution-controller.js';
import { publicTurnOptions, submitNewTurn } from '../interactive-session-turn-submission.js';
import type { IQueuedInput } from '../interactive-session-execution-controller.js';
import type { ISessionRuntimeTools } from '@robota-sdk/agent-interface-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function controller() {
  return new SessionExecutionController(
    {} as never,
    {} as never,
    {
      emit: vi.fn(),
      getSession: () => null,
      persistSession: vi.fn(),
    } as never,
  );
}
function runtime(execCtrl = controller(), init = Promise.resolve()) {
  const session: ISessionRuntimeTools = {
    listRuntimeTools: vi.fn(async () => []),
    invokeRuntimeTool: vi.fn(async () => ({ success: true, toolName: 'tool', result: 'ok' })),
  };
  const tools = new InteractiveSessionRuntimeTools({
    controller: () => execCtrl,
    ensureInitialized: () => init,
    session: () => session,
  });
  return { tools, session, execCtrl };
}

describe('runtime tools and scoped submission cancellation', () => {
  it('claims before initialization and refuses concurrent direct calls and submissions', async () => {
    const init = deferred<void>();
    const { tools, session, execCtrl } = runtime(controller(), init.promise);
    const first = tools.invokeRuntimeTool('tool', {});
    await expect(tools.invokeRuntimeTool('tool', {})).rejects.toThrow(/already running/i);
    await expect(
      submitNewTurn(
        'blocked',
        undefined,
        undefined,
        {},
        {
          execCtrl,
          ensureInitialized: () => init.promise,
          executeAcceptedTurn: vi.fn(),
          emitDropped: vi.fn(),
          isWakeStopped: () => false,
        },
      ),
    ).rejects.toThrow(/runtime tool/i);
    init.resolve();
    await expect(first).resolves.toMatchObject({ success: true });
    expect(session.invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith('tool', {}, undefined);
    expect(execCtrl.executing).toBe(false);
  });

  it('shutdown during initialization refuses execution and drains the admitted call', async () => {
    const init = deferred<void>();
    const { tools, session, execCtrl } = runtime(controller(), init.promise);
    const invocation = tools.invokeRuntimeTool('tool', {});
    execCtrl.shuttingDown = true;
    let drained = false;
    const drain = tools.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    init.resolve();
    await expect(invocation).rejects.toThrow(/shutting down/i);
    await drain;
    expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
    await expect(tools.listRuntimeTools()).rejects.toThrow(/shutting down/i);
  });

  it('cancels one queued submission without touching its active or queued neighbours', async () => {
    const execCtrl = controller();
    const claim = execCtrl.executionClaim.acquire('prompt');
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const deps = {
      execCtrl,
      ensureInitialized: async () => {},
      executeAcceptedTurn: vi.fn(),
      emitDropped: vi.fn(),
      isWakeStopped: () => false,
    };
    const own = await submitNewTurn(
      'own',
      undefined,
      undefined,
      { driverId: 'own', signal: abort.signal },
      deps,
    );
    const other = await submitNewTurn('other', undefined, undefined, { driverId: 'other' }, deps);
    abort.abort();
    await expect(own.completed).rejects.toMatchObject({
      name: 'TurnNotRunError',
      turnId: own.turnId,
      reason: 'cancelled',
    });
    expect(execCtrl.pending.contents.map((entry) => entry.turnId)).toEqual([other.turnId]);
    expect(execCtrl.executing).toBe(true);
    expect(remove).toHaveBeenCalled();
    execCtrl.clearPendingQueue();
    execCtrl.executionClaim.complete(claim, () => {});
  });

  it('preserves cancellation through initialization and never starts a pre-cancelled turn', async () => {
    const execCtrl = controller();
    const init = deferred<void>();
    const abort = new AbortController();
    const executeAcceptedTurn = vi.fn();
    const submission = submitNewTurn(
      'cancelled',
      undefined,
      undefined,
      publicTurnOptions({ signal: abort.signal }),
      {
        execCtrl,
        ensureInitialized: () => init.promise,
        executeAcceptedTurn,
        emitDropped: vi.fn(),
        isWakeStopped: () => false,
      },
    );
    await expect(runtime(execCtrl).tools.invokeRuntimeTool('tool', {})).rejects.toThrow(
      /submission/i,
    );
    abort.abort();
    init.resolve();
    const handle = await submission;
    await expect(handle.completed).rejects.toMatchObject({
      name: 'TurnNotRunError',
      reason: 'cancelled',
    });
    expect(executeAcceptedTurn).not.toHaveBeenCalled();
  });

  it('passes the owned signal to active execution and removes its listener after settlement', async () => {
    const execCtrl = controller();
    const abort = new AbortController();
    const started = deferred<IQueuedInput>();
    const done = deferred<void>();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const submission = submitNewTurn(
      'active',
      undefined,
      undefined,
      { signal: abort.signal },
      {
        execCtrl,
        ensureInitialized: async () => {},
        emitDropped: vi.fn(),
        isWakeStopped: () => false,
        executeAcceptedTurn: async (entry) => {
          started.resolve(entry);
          await done.promise;
          execCtrl.turns.settle(entry.turnId, { response: 'interrupted' } as never);
        },
      },
    );
    const entry = await started.promise;
    expect(entry.options.signal).toBe(abort.signal);
    abort.abort();
    expect(entry.options.signal?.aborted).toBe(true);
    done.resolve();
    const handle = await submission;
    await expect(handle.completed).resolves.toMatchObject({ response: 'interrupted' });
    expect(remove).toHaveBeenCalled();
  });
});
