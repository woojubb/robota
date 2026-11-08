/**
 * Permission and ask prompts over the HTTP routes: forwarded on a prompt-receiving `/submit` stream,
 * listed by `GET /prompts` for a client that came later, and answered by `POST /prompts/:id`.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { createAgentRoutes } from '../routes.js';

import type {
  IInteractiveSession,
  ITurnHandle,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-session';

type TActionResponse = Parameters<IInteractiveSession['resolveAsk']>[1];

const DRIVER = 'remote:http';

function stubHandle(): ITurnHandle {
  return {
    turnId: 'turn-1',
    completed: Promise.resolve({
      response: '',
      history: [],
      toolSummaries: [],
      contextState: { usedTokens: 0, maxTokens: 0, usedPercentage: 0, remainingPercentage: 100 },
    }),
  };
}

/**
 * A session whose turn asks once, the way the real prompt registry does: it parks the prompt only
 * while someone listens for it and fails closed otherwise, settles the first answer for an id, and
 * emits `prompt_resolved` synchronously as it settles.
 */
function createAskingSession(
  kind: 'permission' | 'ask',
  options: { ignoreAnswers?: boolean; throwAfterAsk?: boolean } = {},
) {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const emit = (event: string, data: unknown): void => {
    for (const h of [...(listeners.get(event) ?? [])]) h(data);
  };
  const parked = new Map<string, (value: TPermissionResultValue | TActionResponse) => void>();
  const settle = (id: string, value: TPermissionResultValue | TActionResponse): void => {
    const resolve = parked.get(id);
    if (resolve === undefined) return;
    parked.delete(id);
    resolve(value);
    emit('prompt_resolved', { id });
  };
  const gate = kind === 'permission' ? 'permission_request' : 'ask_request';
  const ask = (): Promise<TPermissionResultValue | TActionResponse> => {
    if ((listeners.get(gate)?.size ?? 0) === 0) {
      return Promise.resolve(kind === 'permission' ? false : { type: 'cancelled' });
    }
    const id = kind === 'permission' ? 'p1' : 'a1';
    return new Promise((resolve) => {
      parked.set(id, resolve);
      emit(
        gate,
        kind === 'permission'
          ? { id, toolName: 'Bash', toolArgs: { command: 'ls' } }
          : { id, request: { id: 'q', title: 'Pick one', options: [{ value: 'x', label: 'X' }] } },
      );
    });
  };
  const resolvePermission = vi.fn((id: string, result: TPermissionResultValue) => {
    if (options.ignoreAnswers !== true) settle(id, result);
  });
  const resolveAsk = vi.fn((id: string, response: TActionResponse) => {
    if (options.ignoreAnswers !== true) settle(id, response);
  });
  const failAllClosed = (): void => {
    for (const id of [...parked.keys()]) {
      settle(id, kind === 'permission' ? false : { type: 'cancelled' });
    }
  };
  const session = createTestInteractiveSession({
    // Like the real session: an aborted turn settles every prompt it left parked.
    abort: failAllClosed,
    submit: (async () => {
      if (options.throwAfterAsk === true) {
        void ask();
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('the turn failed while its prompt was open');
      }
      const answer = await ask();
      emit('complete', { success: true, content: JSON.stringify(answer) });
      return stubHandle();
    }) as IInteractiveSession['submit'],
    resolvePermission: resolvePermission as IInteractiveSession['resolvePermission'],
    resolveAsk: resolveAsk as IInteractiveSession['resolveAsk'],
    on: ((event: string, handler: (data: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: (data: unknown) => void) => {
      listeners.get(event)?.delete(handler);
      // Like the real session: the last prompt listener leaving settles what it left parked.
      if ((listeners.get(gate)?.size ?? 0) === 0) failAllClosed();
    }) as IInteractiveSession['off'],
  });
  return {
    session,
    resolvePermission,
    resolveAsk,
    listenerCount: (e: string) => listeners.get(e)?.size ?? 0,
  };
}

function routesFor(session: IInteractiveSession) {
  return createAgentRoutes({
    sessionFactory: () => ({ ...session }),
    admission: { open: true, openReason: 'unit test' },
    attribution: { driverId: DRIVER, surface: 'remote' },
  });
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Read an SSE response until `until` appears in it; returns everything read so far. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  seen: { text: string },
  until: string,
): Promise<string> {
  const decoder = new TextDecoder();
  while (!seen.text.includes(until)) {
    const { value, done } = await reader.read();
    if (done) break;
    seen.text += decoder.decode(value, { stream: true });
  }
  return seen.text;
}

async function openTurn(routes: ReturnType<typeof routesFor>, receivePrompts?: boolean) {
  const res = await routes.request(
    '/submit',
    json({ prompt: 'go', ...(receivePrompts === undefined ? {} : { receivePrompts }) }),
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  return { reader, seen: { text: '' } };
}

describe('HTTP prompt routes', () => {
  it('forwards a live permission prompt, lists it for a late client, and settles it on approve', async () => {
    const { session, resolvePermission } = createAskingSession('permission');
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);

    expect(await readUntil(reader, seen, 'event: permission_request')).toContain(
      '"toolName":"Bash"',
    );

    const late = await routes.request('/prompts');
    expect(await late.json()).toEqual({
      prompts: [
        {
          type: 'permission_request',
          event: { id: 'p1', toolName: 'Bash', toolArgs: { command: 'ls' } },
        },
      ],
    });

    const answer = await routes.request('/prompts/p1', json({ result: true }));
    expect(answer.status).toBe(200);
    expect(resolvePermission).toHaveBeenCalledWith('p1', true, DRIVER);

    const rest = await readUntil(reader, seen, 'event: complete');
    expect(rest).toContain('event: prompt_resolved');
    expect(rest).toContain('"content":"true"');
    expect(await (await routes.request('/prompts')).json()).toEqual({ prompts: [] });
  });

  it('settles the turn denied when the client answers false', async () => {
    const { session } = createAskingSession('permission');
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);
    await readUntil(reader, seen, 'event: permission_request');

    expect((await routes.request('/prompts/p1', json({ result: false }))).status).toBe(200);
    expect(await readUntil(reader, seen, 'event: complete')).toContain('"content":"false"');
  });

  it('answers an ask prompt', async () => {
    const { session, resolveAsk } = createAskingSession('ask');
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);
    await readUntil(reader, seen, 'event: ask_request');

    const response = { type: 'answer', values: ['x'] };
    expect((await routes.request('/prompts/a1', json({ response }))).status).toBe(200);
    expect(resolveAsk).toHaveBeenCalledWith('a1', response, DRIVER);
    await readUntil(reader, seen, 'event: complete');
  });

  it('refuses an unknown id and an already-settled id with 404', async () => {
    const { session, resolvePermission } = createAskingSession('permission');
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);
    await readUntil(reader, seen, 'event: permission_request');

    expect((await routes.request('/prompts/nope', json({ result: true }))).status).toBe(404);
    expect((await routes.request('/prompts/p1', json({ result: true }))).status).toBe(200);
    const again = await routes.request('/prompts/p1', json({ result: false }));
    expect(again.status).toBe(404);
    expect(resolvePermission).toHaveBeenCalledTimes(1);
    await readUntil(reader, seen, 'event: complete');
  });

  it('refuses a malformed answer and an answer of the wrong kind with 400', async () => {
    const { session, resolvePermission } = createAskingSession('permission');
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);
    await readUntil(reader, seen, 'event: permission_request');

    expect((await routes.request('/prompts/p1', json({ result: 'yes' }))).status).toBe(400);
    expect(
      (await routes.request('/prompts/p1', json({ response: { type: 'cancelled' } }))).status,
    ).toBe(400);
    expect(
      (
        await routes.request('/prompts/p1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
        })
      ).status,
    ).toBe(400);
    expect(resolvePermission).not.toHaveBeenCalled();

    await routes.request('/prompts/p1', json({ result: true }));
    await readUntil(reader, seen, 'event: complete');
  });

  it('leaves prompts unsubscribed without receivePrompts, so the turn fails closed as before', async () => {
    const { session, listenerCount } = createAskingSession('permission');
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes);

    const all = await readUntil(reader, seen, 'event: complete');
    expect(all).not.toContain('permission_request');
    expect(all).toContain('"content":"false"');
    expect(listenerCount('permission_request')).toBe(0);
    expect(await (await routes.request('/prompts')).json()).toEqual({ prompts: [] });
  });

  it('refuses a receivePrompts that is not a boolean', async () => {
    const { session } = createAskingSession('permission');
    const res = await routesFor(session).request(
      '/submit',
      json({ prompt: 'go', receivePrompts: 'yes' }),
    );
    expect(res.status).toBe(400);
  });

  it('forgets the session prompts when the prompt-receiving stream ends', async () => {
    const { session } = createAskingSession('permission');
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);
    await readUntil(reader, seen, 'event: permission_request');

    await reader.cancel();
    await vi.waitFor(async () => {
      expect(await (await routes.request('/prompts')).json()).toEqual({ prompts: [] });
    });
    expect((await routes.request('/prompts/p1', json({ result: true }))).status).toBe(404);
  });

  it('answers 409 when the session did not take the answer', async () => {
    const { session } = createAskingSession('permission', { ignoreAnswers: true });
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);
    await readUntil(reader, seen, 'event: permission_request');

    expect((await routes.request('/prompts/p1', json({ result: true }))).status).toBe(409);
    await reader.cancel();
  });

  it('stops listing a prompt another surface still holds once this stream ended', async () => {
    const { session } = createAskingSession('permission', { throwAfterAsk: true });
    // Another surface listening keeps the prompt parked after this stream lets go of it.
    session.on('permission_request', () => {});
    const routes = routesFor(session);
    const { reader, seen } = await openTurn(routes, true);

    await readUntil(reader, seen, 'event: error');
    expect(await (await routes.request('/prompts')).json()).toEqual({ prompts: [] });
    expect((await routes.request('/prompts/p1', json({ result: true }))).status).toBe(404);
  });
});
