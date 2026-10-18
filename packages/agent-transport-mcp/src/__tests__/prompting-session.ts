/**
 * A session that asks before it acts, the way the real one does: a direct call or a turn parks a
 * permission (or an ask) stamped with the active call's driver id, settles it when a surface
 * answers, fails it closed at once when nobody listens, and settles whatever is still parked when
 * the last listener for that kind of prompt detaches.
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
  listeners(event: TInteractiveEventName): number;
  readonly parkedIds: () => string[];
}

export function createPromptingSession(): IPromptingSession {
  const listeners = new Map<string, Set<TListener>>();
  const parked = new Map<string, { kind: 'permission' | 'ask'; settle: (value: unknown) => void }>();
  let minted = 0;
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
  const park = <T>(kind: 'permission' | 'ask', raise: (id: string) => void): Promise<T> => {
    const id = `${kind === 'permission' ? 'p' : 'a'}${++minted}`;
    const gating = kind === 'permission' ? 'permission_request' : 'ask_request';
    if ((listeners.get(gating)?.size ?? 0) === 0) {
      return Promise.resolve((kind === 'permission' ? false : { type: 'cancelled' }) as T);
    }
    return new Promise<T>((resolve) => {
      parked.set(id, { kind, settle: resolve as (value: unknown) => void });
      raise(id);
    });
  };
  const harness: IPromptingSession = {
    ask: { title: 'Pick one', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    emit: (event: string, data: unknown) => emit(event, data),
    settleClosed,
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
      listRuntimeTools: vi.fn(async () => [PERMISSION_TOOL, ASK_TOOL]),
      invokeRuntimeTool: vi.fn(
        async (name: string, parameters: Record<string, unknown>, options?: { driverId?: string }) => {
          const requesterDriverId = options?.driverId;
          if (name === ASK_TOOL.name) {
            const answer = await park<unknown>('ask', (id) =>
              emit('ask_request', {
                id,
                request: { id, ...harness.ask },
                ...(requesterDriverId ? { requesterDriverId } : {}),
              }),
            );
            return { success: true, toolName: name, result: answer };
          }
          const allowed = await park<unknown>('permission', (id) =>
            emit('permission_request', {
              id,
              toolName: name,
              toolArgs: parameters,
              ...(requesterDriverId ? { requesterDriverId } : {}),
            }),
          );
          return allowed === true
            ? { success: true, toolName: name, result: 'written' }
            : { success: false, toolName: name, error: 'Permission denied' };
        },
      ),
      submit: vi.fn(async (input: string, _d?: string, _r?: string, options?: { driverId?: string }) => {
        const requesterDriverId = options?.driverId;
        const completed = (async () => {
          const allowed = await park<unknown>('permission', (id) =>
            emit('permission_request', {
              id,
              toolName: 'Shell',
              toolArgs: { command: input },
              ...(requesterDriverId ? { requesterDriverId } : {}),
            }),
          );
          return {
            response: allowed === true ? `ran ${input}` : 'denied',
            history: [],
            toolSummaries: [],
          };
        })();
        return { turnId: `turn-${++minted}`, completed };
      }),
    }),
  };
  return harness;
}
