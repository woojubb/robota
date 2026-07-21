/**
 * Tests for HTTP transport routes.
 * Uses Hono's built-in test client — no real HTTP server needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAgentRoutes } from '../routes.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

function createMockSession(overrides?: Record<string, unknown>) {
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 200000,
    }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({
      message: 'Conversation cleared.',
      success: true,
    }),
    listCommands: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as unknown as IInteractiveSession;
}

describe('HTTP Transport Routes', () => {
  function createApp(session?: IInteractiveSession) {
    const mockSession = session ?? createMockSession();
    const app = createAgentRoutes({
      sessionFactory: () => mockSession,
    });
    return { app, mockSession };
  }

  // ── POST /abort ───────────────────────────────────────────────

  it('POST /abort calls session.abort()', async () => {
    const { app, mockSession } = createApp();
    const res = await app.request('/abort', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSession.abort).toHaveBeenCalled();
  });

  // ── POST /cancel-queue ────────────────────────────────────────

  it('POST /cancel-queue calls session.cancelQueue()', async () => {
    const { app, mockSession } = createApp();
    const res = await app.request('/cancel-queue', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSession.cancelQueue).toHaveBeenCalled();
  });

  // ── GET /messages ─────────────────────────────────────────────

  it('GET /messages returns message history', async () => {
    const { app } = createApp();
    const res = await app.request('/messages');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].role).toBe('user');
    expect(body[1].role).toBe('assistant');
  });

  // ── GET /context ──────────────────────────────────────────────

  it('GET /context returns context window state', async () => {
    const { app } = createApp();
    const res = await app.request('/context');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usedTokens).toBe(1000);
    expect(body.maxTokens).toBe(200000);
  });

  // ── GET /executing ────────────────────────────────────────────

  it('GET /executing returns execution status', async () => {
    const { app } = createApp();
    const res = await app.request('/executing');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ executing: false });
  });

  // ── GET /pending ──────────────────────────────────────────────

  it('GET /pending returns null when no queue', async () => {
    const { app } = createApp();
    const res = await app.request('/pending');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: null });
  });

  it('GET /pending returns queued prompt', async () => {
    const mockSession = createMockSession({
      getPendingPrompt: vi.fn().mockReturnValue('queued prompt'),
    });
    const { app } = createApp(mockSession);
    const res = await app.request('/pending');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: 'queued prompt' });
  });

  // ── POST /command ─────────────────────────────────────────────

  it('POST /command executes system command via session.executeCommand()', async () => {
    const { app, mockSession } = createApp();
    const res = await app.request('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'clear', args: '' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Conversation cleared.');
    expect(mockSession.executeCommand).toHaveBeenCalledWith('clear', '');
  });

  it('POST /command returns 400 without name', async () => {
    const { app } = createApp();
    const res = await app.request('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /command returns 404 for unknown command', async () => {
    const mockSession = createMockSession({
      executeCommand: vi.fn().mockResolvedValue(null),
    });
    const { app } = createApp(mockSession);

    const res = await app.request('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  // ── POST /submit validation ───────────────────────────────────

  it('POST /submit returns 400 without prompt', async () => {
    const { app } = createApp();
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // ── POST /submit completion (decoupled from thinking(false)) ──────
  //
  // Regression guard for ARL-04: the /submit done-promise must resolve from the
  // terminal handler (complete/interrupted/error), and the terminal SSE event must
  // be flushed to the client, WITHOUT relying on a trailing thinking(false). Each
  // scripted session emits ONLY its terminal event (no trailing thinking event).

  /**
   * Build a session whose on/off truly register handlers and whose submit()
   * emits exactly one terminal event with NO trailing thinking(false).
   */
  function createEmitterSession(terminalEvent: string, terminalData: unknown) {
    const handlers = new Map<string, Set<(data: unknown) => void>>();
    const session = createMockSession({
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        const set = handlers.get(event) ?? new Set();
        set.add(handler);
        handlers.set(event, set);
      }),
      off: vi.fn((event: string, handler: (data: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }),
      submit: vi.fn(async () => {
        // Emit ONLY the terminal event — deliberately no trailing thinking(false).
        for (const handler of handlers.get(terminalEvent) ?? []) {
          handler(terminalData);
        }
      }),
    });
    return session;
  }

  async function requestSubmit(session: IInteractiveSession): Promise<string> {
    const app = createAgentRoutes({ sessionFactory: () => session });
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.status).toBe(200);
    // Draining the SSE body must complete (no hang) and contain the terminal event.
    return res.text();
  }

  it('POST /submit receives the complete event without a trailing thinking(false)', async () => {
    const session = createEmitterSession('complete', { ok: true });
    const body = await requestSubmit(session);
    expect(body).toContain('event: complete');
    expect(body).toContain('"ok":true');
  });

  it('POST /submit receives the interrupted event without a trailing thinking(false)', async () => {
    const session = createEmitterSession('interrupted', { reason: 'user' });
    const body = await requestSubmit(session);
    expect(body).toContain('event: interrupted');
    expect(body).toContain('"reason":"user"');
  });

  it('POST /submit receives the error event without a trailing thinking(false)', async () => {
    const session = createEmitterSession('error', new Error('boom'));
    const body = await requestSubmit(session);
    expect(body).toContain('event: error');
    expect(body).toContain('"message":"boom"');
  });

  // ── ARCH-004 RUNTIME-38: reject concurrent /submit on a busy session ──

  it('POST /submit returns 409 while a turn is already in flight (isExecuting)', async () => {
    const { app } = createApp(createMockSession({ isExecuting: vi.fn().mockReturnValue(true) }));
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.status).toBe(409);
  });

  // ── ARCH-004 RUNTIME-14: SSE teardown always removes every listener (no leak) ──

  it('POST /submit unsubscribes every listener it added once the stream ends', async () => {
    const session = createEmitterSession('complete', { ok: true });
    await requestSubmit(session);
    // The try/finally teardown must `off` exactly what it `on`'d — a balanced count means zero leaked listeners.
    const onCount = (session.on as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const offCount = (session.off as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(offCount).toBe(onCount);
    expect(onCount).toBeGreaterThan(0);
  });
});
