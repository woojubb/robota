/**
 * Tests for HTTP transport routes.
 * Uses Hono's built-in test client — no real HTTP server needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAgentRoutes } from '../routes.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

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
  } as unknown as InteractiveSession;
}

describe('HTTP Transport Routes', () => {
  function createApp(session?: InteractiveSession) {
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
});
