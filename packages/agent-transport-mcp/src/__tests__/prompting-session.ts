/**
 * A session that asks before it acts, the way the real one does: one turn or direct call drives it
 * at a time (turns queue, a direct call is refused while anything runs); a turn announces itself
 * with `turn_source` once its driver is active; a prompt is stamped with the active driver's id,
 * settles when a surface answers, fails closed at once when nobody listens, and is settled closed
 * when the last listener for its kind detaches.
 */
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { vi } from 'vitest';

import type {
  IAskRequestEvent,
  IInteractiveSession,
  IPermissionRequestEvent,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

export const PERMISSION_TOOL = {
  name: 'fixture_write',
  description: 'Needs permission',
  parameters: { type: 'object' as const, properties: { path: { type: 'string' as const } } },
};

export const ASK_TOOL = {
  name: 'fixture_ask',
  description: 'Asks a question',
  parameters: { type: 'object' as const, properties: {} },
};

type TAskRequest = IAskRequestEvent['request'];
type TListener = (...args: never[]) => void;

export interface IPromptingSession {
  readonly session: IInteractiveSession;
  /** The ask `fixture_ask` raises; set per case. */
  ask: Omit<TAskRequest, 'id'>;
  /** Raises a prompt from outside any call, as another surface's turn would. */
  emit(event: 'permission_request', data: IPermissionRequestEvent): void;
  emit(event: 'ask_request', data: IAskRequestEvent): void;
  /** Settles a parked prompt as the session itself would (a backstop, an abort). */
  settleClosed(id: string): void;
  /**
   * Runs a turn of another driver that, once `gate` opens, asks a permission nobody here routes;
   * resolves with that prompt's decision.
   */
  foreignTurn(gate: Promise<void>): Promise<unknown>;
  listeners(event: TInteractiveEventName): number;
  readonly parkedIds: () => string[];
}

export function createPromptingSession(): IPromptingSession {
  const listeners = new Map<string, Set<TListener>>();
  const parked = new Map<string, { kind: 'permission' | 'ask'; settle: (value: unknown) => void }>();
  let minted = 0;
  let active: string | null = null;
  let busy = false;
  let turns: Promise<void> = Promise.resolve();
  const emit = (event: string, data: unknown): void => {
    for (const handler of [...(listeners.get(event) ?? [])]) (handler as (d: unknown) => void)(data);
  };
  const settle = (id: string, value: unknown, answererDriverId?: string): void => {
    const entry = parked.get(id);
    if (entry === undefined) return;
    parked.delete(id);
    entry.settle(value);
    emit('prompt_resolved', { id, ...(answererDriverId ? { answererDriverId } : {}) });
  };
  const settleClosed = (id: string): void => {
    const entry = parked.get(id);
    if (entry !== undefined) settle(id, entry.kind === 'permission' ? false : { type: 'cancelled' });
  };
  const park = <T>(
    kind: 'permission' | 'ask',
    raise: (id: string) => void,
    signal?: AbortSignal,
  ): Promise<T> => {
    const id = `${kind === 'permission' ? 'p' : 'a'}${++minted}`;
    const gating = kind === 'permission' ? 'permission_request' : 'ask_request';
    if ((listeners.get(gating)?.size ?? 0) === 0 || signal?.aborted === true) {
      return Promise.resolve((kind === 'permission' ? false : { type: 'cancelled' }) as T);
    }
    return new Promise<T>((resolve) => {
      parked.set(id, { kind, settle: resolve as (value: unknown) => void });
      // A cancelled call withdraws its prompt, as the session's registry does.
      signal?.addEventListener('abort', () => settleClosed(id), { once: true });
      raise(id);
    });
  };
  const stamp = (): { requesterDriverId?: string } => (active ? { requesterDriverId: active } : {});
  /** Turns run one at a time, in order; the driver is active from the turn's start to its end. */
  const runTurn = <T>(driverId: string | undefined, body: () => Promise<T>): Promise<T> => {
    const previous = turns;
    let done!: () => void;
    turns = new Promise<void>((resolve) => {
      done = resolve;
    });
    return (async () => {
      await previous;
      busy = true;
      active = driverId ?? null;
      emit('turn_source', 'user');
      try {
        return await body();
      } finally {
        busy = false;
        active = null;
        done();
      }
    })();
  };
  const askPermission = (toolName: string, toolArgs: Record<string, unknown>, signal?: AbortSignal) =>
    park<unknown>(
      'permission',
      (id) => emit('permission_request', { id, toolName, toolArgs, ...stamp() }),
      signal,
    );
  const harness: IPromptingSession = {
    ask: { title: 'Pick one', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    emit: (event: string, data: unknown) => emit(event, data),
    settleClosed,
    foreignTurn: (gate) =>
      runTurn('owner', async () => {
        await gate;
        return askPermission('Shell', { command: 'make' });
      }),
    listeners: (event) => listeners.get(event)?.size ?? 0,
    parkedIds: () => [...parked.keys()],
    session: Object.assign(createTestInteractiveSession(), {
      on: vi.fn((event: string, handler: TListener) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)?.add(handler);
      }),
      off: vi.fn((event: string, handler: TListener) => {
        listeners.get(event)?.delete(handler);
        if ((listeners.get(event)?.size ?? 0) > 0) return;
        const kind = event === 'permission_request' ? 'permission' : event === 'ask_request' ? 'ask' : undefined;
        if (kind === undefined) return;
        for (const [id, entry] of [...parked]) if (entry.kind === kind) settleClosed(id);
      }),
      resolvePermission: vi.fn((id: string, result: unknown, answererDriverId?: string) => {
        if (parked.get(id)?.kind === 'permission') settle(id, result, answererDriverId);
      }),
      resolveAsk: vi.fn((id: string, response: unknown, answererDriverId?: string) => {
        if (parked.get(id)?.kind === 'ask') settle(id, response, answererDriverId);
      }),
      getActiveDriverId: () => active,
      listRuntimeTools: vi.fn(async () => [PERMISSION_TOOL, ASK_TOOL]),
      invokeRuntimeTool: vi.fn(
        async (
          name: string,
          parameters: Record<string, unknown>,
          options?: {
            signal?: AbortSignal;
            driverId?: string;
            permissionInteraction?: 'interactive' | 'deny';
          },
        ) => {
          // A direct call takes the session as it is invoked, or is refused while anything runs.
          if (busy) throw new Error('Another prompt or command is already running.');
          busy = true;
          active = options?.driverId ?? null;
          const interactive = options?.permissionInteraction === 'interactive';
          try {
            await Promise.resolve();
            if (name === ASK_TOOL.name) {
              // The ask port reaches a direct call only when its caller answers its own prompts.
              const answer = interactive
                ? await park<unknown>(
                    'ask',
                    (id) => emit('ask_request', { id, request: { id, ...harness.ask }, ...stamp() }),
                    options?.signal,
                  )
                : 'unavailable';
              return { success: true, toolName: name, result: answer };
            }
            // A direct call denies without asking unless its caller answers its own prompts.
            const allowed =
              interactive && (await askPermission(name, parameters, options?.signal));
            return allowed === true
              ? { success: true, toolName: name, result: 'written' }
              : { success: false, toolName: name, error: 'Permission denied' };
          } finally {
            busy = false;
            active = null;
          }
        },
      ),
      submit: vi.fn(
        async (
          input: string,
          _display?: string,
          _raw?: string,
          options?: { signal?: AbortSignal; driverId?: string },
        ) => {
        const completed = runTurn(options?.driverId, async () => {
          const allowed = await askPermission('Shell', { command: input }, options?.signal);
          return {
            response: allowed === true ? `ran ${input}` : 'denied',
            history: [],
            toolSummaries: [],
          };
        });
        return { turnId: `turn-${++minted}`, completed };
        },
      ),
    }),
  };
  return harness;
}
