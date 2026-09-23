import { describe, expect, it, vi } from 'vitest';

import { InteractiveExecutionClaimOwner } from '../interactive-execution-claim.js';
import { SessionExecutionController } from '../interactive-session-execution-controller.js';

function createController(
  callbackOverrides: Record<string, unknown> = {},
): SessionExecutionController {
  return new SessionExecutionController(
    { getHistory: () => [] } as never,
    {} as never,
    {
      emit: vi.fn(),
      getContextState: vi.fn(),
      getCwd: () => process.cwd(),
      getSession: () => null,
      getSessionOrThrow: vi.fn(),
      persistSession: vi.fn(),
      ...callbackOverrides,
    } as never,
  );
}

describe('interactive foreground execution claim ownership', () => {
  it('does not let a stale claim release its successor', () => {
    const owner = new InteractiveExecutionClaimOwner([]);
    const stale = owner.acquire('prompt');

    expect(owner.active).toBe(true);
    owner.complete(stale, vi.fn());

    const current = owner.acquire('foreground-command');
    owner.complete(stale, vi.fn());
    expect(owner.active).toBe(true);

    owner.complete(current, vi.fn());
    expect(owner.active).toBe(false);
  });

  it('does not let stale completion run idle, persistence, or queue handoff', () => {
    const emitIdle = vi.fn();
    const persist = vi.fn();
    const handoff = vi.fn();
    const owner = new InteractiveExecutionClaimOwner([emitIdle, persist]);
    const stale = owner.acquire('prompt');

    owner.complete(stale, vi.fn());
    emitIdle.mockClear();
    persist.mockClear();
    const current = owner.acquire('foreground-command');

    owner.complete(stale, handoff);

    expect(owner.active).toBe(true);
    expect(emitIdle).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
    owner.complete(current, vi.fn());
  });

  it('uses one mutually exclusive claim across every execution kind', () => {
    const owner = new InteractiveExecutionClaimOwner([]);
    const claim = owner.acquire('fork-skill');

    expect(() => owner.acquire('prompt')).toThrow(/already running/i);
    expect(() => owner.acquire('foreground-command')).toThrow(/already running/i);
    expect(owner.active).toBe(true);

    owner.complete(claim, vi.fn());
    expect(owner.active).toBe(false);
  });

  it('rejects and settles a prompt handle when claim acquisition fails', async () => {
    const controller = createController();
    let finishForeground!: () => void;
    const foreground = controller.executeForegroundCommand(
      () =>
        new Promise((resolve) => {
          finishForeground = () => resolve({ success: true, message: 'done' });
        }),
      () => Promise.resolve(),
    );
    const turn = controller.turns.begin();

    await expect(
      controller.executePrompt(
        'blocked',
        undefined,
        undefined,
        [],
        [],
        null,
        vi.fn(),
        () => Promise.resolve(),
        turn.turnId,
      ),
    ).rejects.toThrow(/already running/i);
    await expect(turn.completed).rejects.toThrow(/already running/i);
    expect(controller.executing).toBe(true);

    finishForeground();
    await expect(foreground).resolves.toMatchObject({ success: true });
  });

  it('keeps the claim through callbacks and hands the queue off before re-entry', async () => {
    let reentrant!: Promise<unknown>;
    // `controller` is read inside the callback only after `createController` returns, so a `const`
    // declared below is safe here (prefer-const, issue #2254).
    const persistSession = vi.fn(() => {
      expect(controller.executing).toBe(true);
      reentrant = controller.executeForegroundCommand(
        async () => ({ success: true, message: 'must not run' }),
        () => Promise.resolve(),
      );
    });
    const controller: SessionExecutionController = createController({ persistSession });
    const queued = controller.turns.begin();
    controller.enqueuePending({ input: 'queued', options: {}, turnId: queued.turnId });
    const resumed: string[] = [];

    const result = await controller.executeForegroundCommand(
      async () => ({ success: true, message: 'owner' }),
      async (entry) => {
        await controller.executeForegroundCommand(
          async () => {
            resumed.push(entry.input);
            controller.turns.settle(entry.turnId, { response: entry.input } as never);
            return { success: true, message: 'queued' };
          },
          () => Promise.resolve(),
        );
      },
    );

    expect(result).toEqual({ success: true, message: 'owner' });
    await expect(reentrant).resolves.toMatchObject({ success: false });
    await expect(queued.completed).resolves.toMatchObject({ response: 'queued' });
    expect(resumed).toEqual(['queued']);
    expect(controller.executing).toBe(false);
  });

  it('releases a foreground claim when an entry callback throws', async () => {
    const controller = createController({
      emit: vi.fn((event: string, value: unknown) => {
        if (event === 'thinking' && value === true) throw new Error('listener failed');
      }),
    });

    await expect(
      controller.executeForegroundCommand(
        async () => ({ success: true, message: 'unreachable' }),
        () => Promise.resolve(),
      ),
    ).resolves.toMatchObject({ success: false, message: 'Error: listener failed' });
    expect(controller.executing).toBe(false);
  });

  it('still releases and hands off the queued turn when persistence throws', async () => {
    const controller = createController({
      persistSession: vi.fn(() => {
        throw new Error('persist failed');
      }),
    });
    const queued = controller.turns.begin();
    controller.enqueuePending({ input: 'queued', options: {}, turnId: queued.turnId });

    await expect(
      controller.executeForegroundCommand(
        async () => ({ success: true, message: 'owner' }),
        async (entry) => {
          controller.turns.settle(entry.turnId, { response: entry.input } as never);
        },
      ),
    ).rejects.toThrow(/persist failed/);

    await expect(queued.completed).resolves.toMatchObject({ response: 'queued' });
    expect(controller.executing).toBe(false);
    expect(controller.pendingCount()).toBe(0);
  });

  it('releases a fork-skill claim when an entry callback throws', async () => {
    const controller = new SessionExecutionController(
      { append: vi.fn() } as never,
      { executeSkillWithActivation: vi.fn() } as never,
      {
        emit: vi.fn((event: string, value: unknown) => {
          if (event === 'thinking' && value === true) throw new Error('listener failed');
        }),
        getContextState: vi.fn(),
        getCwd: () => process.cwd(),
        getSession: () => null,
        getSessionOrThrow: vi.fn(),
        persistSession: vi.fn(),
      } as never,
    );

    await expect(
      controller.executeForkSkillCommand(
        { name: 'forked' } as never,
        '',
        undefined,
        undefined,
        'user-slash',
        () => Promise.resolve(),
      ),
    ).resolves.toEqual({ mode: 'fork', result: '' });
    expect(controller.executing).toBe(false);
  });

  it('commits trimmed tool state before a synchronous tool-end listener reads it', () => {
    const observedCounts: number[] = [];
    const controller: SessionExecutionController = createController({
      emit: vi.fn((event: string) => {
        if (event === 'tool_end') observedCounts.push(controller.activeTools.length);
      }),
    });

    for (let index = 0; index < 51; index += 1) {
      const toolName = `tool-${index}`;
      controller.handleToolExecution({ type: 'start', toolName });
      controller.handleToolExecution({ type: 'end', toolName, success: true });
    }

    expect(controller.activeTools).toHaveLength(50);
    expect(observedCounts.at(-1)).toBe(50);
  });
});
