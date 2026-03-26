import { describe, it, expect, vi } from 'vitest';
import { HttpExecutor } from '../executors/http-executor.js';
import type { IHookInput } from '../types.js';

describe('HttpExecutor', () => {
  const executor = new HttpExecutor();

  it('should have type "http"', () => {
    expect(executor.type).toBe('http');
  });

  it('should POST hook input to URL and return result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = { type: 'http' as const, url: 'https://example.com/hook' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('should send JSON body with Content-Type header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = { type: 'http' as const, url: 'https://example.com/hook' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'SessionStart',
    };
    await executor.execute(definition, input);

    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    expect(callArgs.headers).toEqual(
      expect.objectContaining({ 'Content-Type': 'application/json' }),
    );
    expect(callArgs.body).toBe(JSON.stringify(input));

    vi.unstubAllGlobals();
  });

  it('should return exit code 2 when response has ok: false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, reason: 'blocked' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = { type: 'http' as const, url: 'https://example.com/hook' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('blocked');

    vi.unstubAllGlobals();
  });

  it('should return exit code 1 on HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = { type: 'http' as const, url: 'https://example.com/hook' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('500');

    vi.unstubAllGlobals();
  });

  it('should return exit code 1 on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const definition = { type: 'http' as const, url: 'https://example.com/hook' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Network failure');

    vi.unstubAllGlobals();
  });

  it('should interpolate env vars in custom headers', async () => {
    process.env['TEST_TOKEN'] = 'secret-value';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = {
      type: 'http' as const,
      url: 'https://example.com/hook',
      headers: { Authorization: 'Bearer $TEST_TOKEN' },
    };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'SessionStart',
    };
    await executor.execute(definition, input);

    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-value');

    delete process.env['TEST_TOKEN'];
    vi.unstubAllGlobals();
  });

  it('should leave header value unchanged when env var is not set', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = {
      type: 'http' as const,
      url: 'https://example.com/hook',
      headers: { Authorization: 'Bearer $NONEXISTENT_VAR' },
    };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'SessionStart',
    };
    await executor.execute(definition, input);

    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer $NONEXISTENT_VAR');

    vi.unstubAllGlobals();
  });
});
