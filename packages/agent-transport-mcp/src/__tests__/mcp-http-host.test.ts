import { request as httpRequest } from 'node:http';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createMcpHttpHost } from '../mcp-http-host.js';

const schema = {
  name: 'robota_command_help',
  description: 'Canonical command',
  parameters: { type: 'object' as const, properties: {} },
};

function fixture() {
  return Object.assign(createTestInteractiveSession(), {
    listRuntimeTools: vi.fn().mockResolvedValue([schema]),
    invokeRuntimeTool: vi.fn().mockResolvedValue({ success: true, result: 'ran' }),
  });
}

async function connect(url: string, token: string, modern: boolean): Promise<Client> {
  const client = new Client(
    { name: 'http-test', version: '1' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
  });
}

describe('loopback MCP HTTP host', () => {
  it.each([false, true])('serves a real %s-era SDK client through one session', async (modern) => {
    const session = fixture();
    const host = createMcpHttpHost({ name: 'robota', version: '1', session });
    const endpoint = await host.start();
    const client = await connect(endpoint.url, endpoint.token, modern);
    try {
      expect(client.getProtocolEra()).toBe(modern ? 'modern' : 'legacy');
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        schema.name,
        'agent_submit',
      ]);
      expect(await client.callTool({ name: schema.name, arguments: {} })).toMatchObject({
        isError: false,
      });
      expect(session.invokeRuntimeTool).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await host.stop();
    }
  });

  it('rejects missing bearer and hostile Host/Origin before execution', async () => {
    const session = fixture();
    const host = createMcpHttpHost({ name: 'robota', version: '1', session });
    const endpoint = await host.start();
    const hostName = new URL(endpoint.url).host;
    const base = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${endpoint.token}`,
      Host: hostName,
    };
    try {
      expect(await rawStatus(endpoint.url, { ...base, Authorization: '' })).toBe(401);
      expect(await rawStatus(endpoint.url, { ...base, Host: 'attacker.test' })).toBe(403);
      expect(await rawStatus(endpoint.url, { ...base, Origin: 'http://attacker.test' })).toBe(403);
      expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
    } finally {
      await host.stop();
    }
  });

  it('refuses non-loopback binding before listening', () => {
    expect(() =>
      createMcpHttpHost({ name: 'robota', version: '1', session: fixture(), host: '0.0.0.0' }),
    ).toThrow(/loopback/);
  });

  it('rejects an oversized HTTP body before the SDK or runtime sees it', async () => {
    const session = fixture();
    const host = createMcpHttpHost({ name: 'robota', version: '1', session });
    const endpoint = await host.start();
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          'Content-Type': 'application/json',
        },
        body: 'x'.repeat(1024 * 1024 + 1),
      });
      expect(response.status).toBe(413);
      expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
    } finally {
      await host.stop();
    }
  });

  it('aborts a modern in-flight runtime call when its client disconnects', async () => {
    const session = fixture();
    let runtimeSignal: AbortSignal | undefined;
    session.invokeRuntimeTool.mockImplementation(async (_name, _parameters, options) => {
      runtimeSignal = options.signal;
      await new Promise<void>((resolve) =>
        options.signal.addEventListener('abort', resolve, { once: true }),
      );
      return { success: false, error: 'cancelled' };
    });
    const host = createMcpHttpHost({ name: 'robota', version: '1', session });
    const endpoint = await host.start();
    const client = await connect(endpoint.url, endpoint.token, true);
    try {
      const controller = new AbortController();
      const call = client.callTool(
        { name: schema.name, arguments: {} },
        { signal: controller.signal },
      );
      await vi.waitFor(() => expect(runtimeSignal).toBeDefined());
      controller.abort();
      await expect(call).rejects.toThrow();
      await vi.waitFor(() => expect(runtimeSignal?.aborted).toBe(true));
    } finally {
      await client.close();
      await host.stop();
    }
  });

  it('does not open a listener after stop wins pending catalog validation', async () => {
    const session = fixture();
    let release: (() => void) | undefined;
    session.listRuntimeTools.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([schema]);
        }),
    );
    const host = createMcpHttpHost({ name: 'robota', version: '1', session });
    const start = host.start();
    await vi.waitFor(() => expect(release).toBeDefined());
    await host.stop();
    release?.();
    await expect(start).rejects.toThrow(/stopped/);
    await expect(host.waitForClose()).resolves.toBeUndefined();
  });

  it('admits only one concurrent start, leaving no hidden listener after stop', async () => {
    const session = fixture();
    const host = createMcpHttpHost({ name: 'robota', version: '1', session });
    const first = host.start();
    await expect(host.start()).rejects.toThrow(/already started/);
    const endpoint = await first;
    await host.stop();
    await expect(host.waitForClose()).resolves.toBeUndefined();
    await expect(fetch(endpoint.url)).rejects.toThrow();
  });
});
