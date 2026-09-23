import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentMcpServer } from '../mcp-server.js';
import type { IMcpTransportSession } from '../mcp-session.js';

const schema = {
  name: 'robota_command_help',
  description: 'Canonical command',
  parameters: { type: 'object' as const, properties: { args: { type: 'string' as const } } },
};
const sessions = (overrides = {}) =>
  Object.assign(createTestInteractiveSession(), {
    listRuntimeTools: vi.fn().mockResolvedValue([schema]),
    invokeRuntimeTool: vi
      .fn()
      .mockResolvedValue({ success: true, result: 'ran', executionId: 'call-1' }),
    ...overrides,
  });
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
async function connect(session: IMcpTransportSession = sessions()) {
  const server = await createAgentMcpServer({ name: 'test', version: '1', session });
  const [peer, host] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' });
  clients.push(client);
  await Promise.all([client.connect(peer), server.connect(host)]);
  return client;
}

describe('canonical MCP runtime tools', () => {
  it('serves the catalog, invocation, and submit through only the declared port', async () => {
    const full = createTestInteractiveSession();
    const port: IMcpTransportSession = {
      submit: full.submit,
      listRuntimeTools: async () => [schema],
      invokeRuntimeTool: async (name) => ({ success: true, toolName: name, result: 'ran' }),
    };
    expect(Object.keys(port)).toHaveLength(3);
    const client = await connect(port);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      schema.name,
      'robota_submit',
    ]);
    expect(await client.callTool({ name: schema.name, arguments: {} })).toMatchObject({
      isError: false,
    });
    expect(await client.callTool({ name: 'robota_submit', arguments: { prompt: 'hello' } })).toMatchObject({
      content: [{ type: 'text', text: '' }],
    });
  });

  it('publishes canonical schemas and the reserved submission extension only', async () => {
    const client = await connect();
    expect((await client.listTools()).tools).toEqual([
      { name: schema.name, description: schema.description, inputSchema: schema.parameters },
      expect.objectContaining({ name: 'robota_submit' }),
    ]);
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
  });

  it('preserves the runtime result envelope and forwards cancellation context', async () => {
    const session = sessions();
    const client = await connect(session);
    const result = await client.callTool({ name: schema.name, arguments: { args: 'x' } });
    expect(session.invokeRuntimeTool).toHaveBeenCalledWith(
      schema.name,
      { args: 'x' },
      { signal: expect.any(AbortSignal) },
    );
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, result: 'ran', executionId: 'call-1' }),
        },
      ],
      isError: false,
    });
  });

  it('reports permission failures without leaking into another call', async () => {
    const session = sessions();
    session.invokeRuntimeTool.mockResolvedValueOnce({ success: false, error: 'Permission denied' });
    const client = await connect(session);
    expect(await client.callTool({ name: schema.name })).toMatchObject({ isError: true });
    expect(await client.callTool({ name: schema.name })).toMatchObject({ isError: false });
  });

  it('rejects unknown and retired aliases without invoking the runtime', async () => {
    const session = sessions();
    const client = await connect(session);
    for (const name of ['command_help', 'submit', 'unknown']) {
      expect(await client.callTool({ name })).toMatchObject({ isError: true });
    }
    expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
  });

  it('fails startup when the runtime owns the reserved name', async () => {
    await expect(
      createAgentMcpServer({
        name: 'test',
        version: '1',
        session: sessions({
          listRuntimeTools: vi.fn().mockResolvedValue([{ ...schema, name: 'robota_submit' }]),
        }),
      }),
    ).rejects.toThrow(/reserved/i);
  });

  it('rejects duplicate names and non-object schemas before accepting a carrier', async () => {
    for (const catalog of [[schema, schema], [{ ...schema, parameters: { type: 'string' } }]]) {
      await expect(
        createAgentMcpServer({
          name: 'test',
          version: '1',
          session: sessions({
            listRuntimeTools: vi.fn().mockResolvedValue(catalog),
          }),
        }),
      ).rejects.toThrow();
    }
  });

  it('does not advertise or serve prompts and resources', async () => {
    const client = await connect();
    await expect(client.listPrompts()).rejects.toThrow();
    await expect(client.listResources()).rejects.toThrow();
  });

  it('forwards submission cancellation without using global turn control', async () => {
    const base = createTestInteractiveSession();
    const session = sessions({ submit: vi.fn(base.submit), abort: vi.fn(), cancelQueue: vi.fn() });
    const client = await connect(session);
    await client.callTool({ name: 'robota_submit', arguments: { prompt: 'hello' } });
    expect(session.submit).toHaveBeenCalledWith('hello', undefined, undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(session.abort).not.toHaveBeenCalled();
    expect(session.cancelQueue).not.toHaveBeenCalled();
  });

  it('rechecks catalog mutations and fails visibly on a later collision', async () => {
    const session = sessions();
    const client = await connect(session);
    session.listRuntimeTools.mockResolvedValue([{ ...schema, name: 'robota_submit' }]);
    await expect(client.listTools()).rejects.toThrow(/reserved/i);
    expect(await client.callTool({ name: schema.name })).toMatchObject({ isError: true });
    expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
  });

  it('does not accept a malformed submission prompt', async () => {
    const session = sessions({ submit: vi.fn() });
    const client = await connect(session);
    for (const prompt of [123, '', null]) {
      expect(await client.callTool({ name: 'robota_submit', arguments: { prompt } })).toMatchObject(
        { isError: true },
      );
    }
    expect(session.submit).not.toHaveBeenCalled();
  });

  it('cancels only the request signal supplied to the runtime', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const session = sessions({
      invokeRuntimeTool: vi.fn(async (_name, _args, options) => {
        observedSignal = options.signal;
        started();
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return { success: false, error: 'Cancelled' };
      }),
    });
    const client = await connect(session);
    const cancellation = new AbortController();
    const call = client.callTool({ name: schema.name }, undefined, { signal: cancellation.signal });
    const rejected = expect(call).rejects.toThrow();
    await ready;
    cancellation.abort();
    await rejected;
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
  });
});
