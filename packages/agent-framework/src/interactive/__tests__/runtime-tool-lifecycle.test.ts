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
function runtime(
  execCtrl = controller(),
  init = Promise.resolve(),
  invoke: ISessionRuntimeTools['invokeRuntimeTool'] = async () => ({
    success: true,
    toolName: 'tool',
    result: 'ok',
  }),
) {
  const session: ISessionRuntimeTools = {
    listRuntimeTools: vi.fn(async () => []),
    invokeRuntimeTool: vi.fn(invoke),
  };
  const resumeQueuedTurn = vi.fn(async (_entry: IQueuedInput) => {});
  const tools = new InteractiveSessionRuntimeTools({
    controller: () => execCtrl,
    ensureInitialized: () => init,
    session: () => session,
    resumeQueuedTurn,
  });
  return { tools, session, execCtrl, resumeQueuedTurn };
}
function submissionDeps(execCtrl: SessionExecutionController, init = Promise.resolve()) {
  return {
    execCtrl,
    assertInputAllowed: vi.fn(),
    ensureInitialized: () => init,
    executeAcceptedTurn: vi.fn(),
    emitDropped: vi.fn(),
    isWakeStopped: () => false,
  };
}

describe('runtime tools and scoped submission cancellation', () => {
  it('claims before initialization and refuses a concurrent direct call', async () => {
    const init = deferred<void>();
    const { tools, session, execCtrl } = runtime(controller(), init.promise);
    const first = tools.invokeRuntimeTool('tool', {});
    await expect(tools.invokeRuntimeTool('tool', {})).rejects.toThrow(/already running/i);
    init.resolve();
    await expect(first).resolves.toMatchObject({ success: true });
    expect(session.invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
      'tool',
      {},
      {
        executionId: expect.any(String),
      },
    );
    expect(execCtrl.executing).toBe(false);
  });

  it('queues a submission that arrives during a direct call and starts it when the call ends', async () => {
    const hold = deferred<void>();
    const { tools, execCtrl, resumeQueuedTurn } = runtime(
      controller(),
      Promise.resolve(),
      async () => {
        await hold.promise;
        return { success: true, toolName: 'tool', result: 'ok' };
      },
    );
    const call = tools.invokeRuntimeTool('tool', {});
    await Promise.resolve();
    const deps = submissionDeps(execCtrl);

    // A call parked on a permission prompt can last a long time; input must not be refused for it.
    const handle = await submitNewTurn('later', undefined, undefined, {}, deps);

    expect(execCtrl.pendingCount()).toBe(1);
    expect(deps.executeAcceptedTurn).not.toHaveBeenCalled();
    expect(resumeQueuedTurn).not.toHaveBeenCalled();
    hold.resolve();
    await call;
    expect(resumeQueuedTurn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ input: 'later', turnId: handle.turnId }),
    );
    expect(execCtrl.pendingCount()).toBe(0);
  });

  it('keeps an agent wakeup that arrives during a direct call instead of dropping it', async () => {
    const hold = deferred<void>();
    const { tools, execCtrl, resumeQueuedTurn } = runtime(
      controller(),
      Promise.resolve(),
      async () => {
        await hold.promise;
        return { success: true, toolName: 'tool', result: 'ok' };
      },
    );
    const call = tools.invokeRuntimeTool('tool', {});
    await Promise.resolve();

    await submitNewTurn(
      'wake',
      undefined,
      undefined,
      { turnSource: 'agent-wakeup', wakeTaskId: 'task-1' },
      submissionDeps(execCtrl),
    );
    hold.resolve();
    await call;

    expect(resumeQueuedTurn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        input: 'wake',
        options: expect.objectContaining({ wakeTaskId: 'task-1', turnSource: 'agent-wakeup' }),
      }),
    );
  });

  it('still refuses a direct call while input is queued behind another', async () => {
    const hold = deferred<void>();
    const { tools, execCtrl } = runtime(controller(), Promise.resolve(), async () => {
      await hold.promise;
      return { success: true, toolName: 'tool', result: 'ok' };
    });
    const call = tools.invokeRuntimeTool('tool', {});
    await Promise.resolve();
    await submitNewTurn('later', undefined, undefined, {}, submissionDeps(execCtrl));

    // Fail fast for the direct caller: the claim is held and input is already waiting for it.
    await expect(tools.invokeRuntimeTool('tool', {})).rejects.toThrow(/queued/i);
    hold.resolve();
    await call;
    // The queued input started in the call's place, so the next direct call finds the queue drained.
    expect(execCtrl.pendingCount()).toBe(0);
  });

  it('recognises its own call by the id it started with, and only while it runs', async () => {
    const execCtrl = controller();
    const during: string[][] = [];
    const received: Array<string | undefined> = [];
    const { tools } = runtime(execCtrl, Promise.resolve(), async (_name, _parameters, options) => {
      during.push([...execCtrl.directCallIds]);
      received.push(options?.executionId);
      return { success: true, toolName: 'tool', result: 'ok' };
    });

    await tools.invokeRuntimeTool('tool', {});
    await tools.invokeRuntimeTool('tool', {}, { executionId: 'named-by-caller' });

    expect(during[0]).toEqual([received[0]]);
    expect(received[0]).toEqual(expect.any(String));
    expect(during[1]).toEqual(['named-by-caller']);
    expect(received[1]).toBe('named-by-caller');
    expect(execCtrl.directCallIds.size).toBe(0);
  });

  it('forgets the id of a direct call that failed, and registers none for a refused one', async () => {
    const execCtrl = controller();
    const { tools } = runtime(execCtrl, Promise.resolve(), async () => {
      throw new Error('tool exploded');
    });
    await expect(tools.invokeRuntimeTool('tool', {})).rejects.toThrow('tool exploded');
    expect(execCtrl.directCallIds.size).toBe(0);

    const claim = execCtrl.executionClaim.acquire('prompt');
    await expect(tools.invokeRuntimeTool('tool', {})).rejects.toThrow(/already running/i);
    expect(execCtrl.directCallIds.size).toBe(0);
    execCtrl.executionClaim.complete(claim, () => {});
  });

  it('attributes a direct call to the driver it acts for, only while it runs', async () => {
    const execCtrl = controller();
    const seen: Array<string | null> = [];
    const session: ISessionRuntimeTools = {
      listRuntimeTools: vi.fn(async () => []),
      invokeRuntimeTool: vi.fn(async () => {
        seen.push(execCtrl.activeDriverId);
        return { success: true, toolName: 'tool', result: 'ok' };
      }),
    };
    const tools = new InteractiveSessionRuntimeTools({
      controller: () => execCtrl,
      ensureInitialized: () => Promise.resolve(),
      session: () => session,
      resumeQueuedTurn: vi.fn(async () => {}),
    });
    const options = { driverId: 'drv-1', permissionInteraction: 'interactive' as const };

    await tools.invokeRuntimeTool('tool', {}, options);
    expect(seen).toEqual(['drv-1']);
    expect(session.invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
      'tool',
      {},
      {
        ...options,
        executionId: expect.any(String),
      },
    );
    expect(execCtrl.activeDriverId).toBeNull();

    await tools.invokeRuntimeTool('tool', {});
    expect(seen).toEqual(['drv-1', null]);
  });

  it('clears the attributed driver when the direct call fails', async () => {
    const execCtrl = controller();
    const session: ISessionRuntimeTools = {
      listRuntimeTools: vi.fn(async () => []),
      invokeRuntimeTool: vi.fn(async () => {
        throw new Error('tool exploded');
      }),
    };
    const tools = new InteractiveSessionRuntimeTools({
      controller: () => execCtrl,
      ensureInitialized: () => Promise.resolve(),
      session: () => session,
      resumeQueuedTurn: vi.fn(async () => {}),
    });
    await expect(tools.invokeRuntimeTool('tool', {}, { driverId: 'drv-1' })).rejects.toThrow(
      'tool exploded',
    );
    expect(execCtrl.activeDriverId).toBeNull();
    expect(execCtrl.executing).toBe(false);
  });

  it('leaves the active turn driver alone when a direct call is refused', async () => {
    const execCtrl = controller();
    const claim = execCtrl.executionClaim.acquire('prompt');
    execCtrl.activeDriverId = 'turn-driver';
    const { tools } = runtime(execCtrl);
    await expect(tools.invokeRuntimeTool('tool', {}, { driverId: 'intruder' })).rejects.toThrow(
      /already running/i,
    );
    expect(execCtrl.activeDriverId).toBe('turn-driver');
    execCtrl.executionClaim.complete(claim, () => {});
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
      assertInputAllowed: vi.fn(),
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
        assertInputAllowed: vi.fn(),
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
        assertInputAllowed: vi.fn(),
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
