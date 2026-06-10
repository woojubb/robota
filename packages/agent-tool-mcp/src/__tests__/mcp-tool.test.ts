import { afterEach, describe, expect, it } from 'vitest';
import { ToolExecutionError } from '@robota-sdk/agent-core';

import { createMCPTool } from '../mcp-tool.js';
import { startMockMcpServer } from './mock-mcp-server.js';

import type { IToolSchema } from '@robota-sdk/agent-core';
import type { IMockMcpServer } from './mock-mcp-server.js';

const SCHEMA: IToolSchema = {
  name: 'echo',
  description: 'Echo tool exposed by the mock MCP server',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

let server: IMockMcpServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('MCPTool against a mock MCP server', () => {
  it('TC-01: completes initialize handshake then tools/call with spec params', async () => {
    server = await startMockMcpServer({ toolResultText: 'echoed: hi' });
    const tool = createMCPTool({ endpoint: server.url }, SCHEMA);

    const result = await tool.execute({ text: 'hi' });

    expect(result.success).toBe(true);
    const data = result.data as { content?: string };
    expect(data.content).toBe('echoed: hi');

    const methods = server.requests.map((r) => (r.body?.['method'] as string) ?? r.method);
    expect(methods[0]).toBe('initialize');
    expect(methods[1]).toBe('notifications/initialized');
    expect(methods[2]).toBe('tools/call');

    const callParams = server.requests[2]?.body?.['params'] as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    expect(callParams.name).toBe('echo');
    expect(callParams.arguments).toEqual({ text: 'hi' });
  });

  it('TC-02: JSON-RPC error response makes execute throw ToolExecutionError', async () => {
    server = await startMockMcpServer({
      toolCallJsonRpcError: { code: -32000, message: 'tool exploded' },
    });
    const tool = createMCPTool({ endpoint: server.url }, SCHEMA);
    await expect(tool.execute({ text: 'x' })).rejects.toThrow(ToolExecutionError);
    await expect(
      createMCPTool({ endpoint: server.url }, SCHEMA).execute({ text: 'x' }),
    ).rejects.toThrow(/tool exploded/);
  });

  it('TC-02: isError tool result also throws', async () => {
    server = await startMockMcpServer({ toolCallIsError: true, toolResultText: 'bad input' });
    const tool = createMCPTool({ endpoint: server.url }, SCHEMA);
    await expect(tool.execute({ text: 'x' })).rejects.toThrow(/bad input/);
  });

  it('TC-03: timeout aborts a delayed tools/call', async () => {
    server = await startMockMcpServer({ toolCallDelayMs: 1500 });
    const tool = createMCPTool({ endpoint: server.url, timeout: 200, retries: 0 }, SCHEMA);
    await expect(tool.execute({ text: 'x' })).rejects.toThrow(ToolExecutionError);
  }, 10000);

  it('TC-03: retries HTTP 5xx the configured number of times then succeeds', async () => {
    server = await startMockMcpServer({ failFirstToolCalls: 2, toolResultText: 'ok after retry' });
    const tool = createMCPTool({ endpoint: server.url, retries: 3 }, SCHEMA);
    const result = await tool.execute({ text: 'x' });
    expect((result.data as { content?: string }).content).toBe('ok after retry');
    const toolCalls = server.requests.filter((r) => r.body?.['method'] === 'tools/call');
    expect(toolCalls).toHaveLength(3);
  });

  it('TC-03: exhausted retries throw', async () => {
    server = await startMockMcpServer({ failFirstToolCalls: 10 });
    const tool = createMCPTool({ endpoint: server.url, retries: 1 }, SCHEMA);
    await expect(tool.execute({ text: 'x' })).rejects.toThrow(ToolExecutionError);
    const toolCalls = server.requests.filter((r) => r.body?.['method'] === 'tools/call');
    expect(toolCalls).toHaveLength(2);
  });

  it('TC-04: forwards Authorization bearer apiKey and custom headers; echoes session id; DELETE on disconnect', async () => {
    server = await startMockMcpServer({ sessionId: 'sess-42', toolResultText: 'ok' });
    const tool = createMCPTool(
      { endpoint: server.url, apiKey: 'secret-key', headers: { 'X-Team': 'robota' } },
      SCHEMA,
    );
    await tool.execute({ text: 'x' });
    await tool.disconnect();

    const init = server.requests[0];
    expect(init?.headers['authorization']).toBe('Bearer secret-key');
    expect(init?.headers['x-team']).toBe('robota');

    const call = server.requests.find((r) => r.body?.['method'] === 'tools/call');
    expect(call?.headers['mcp-session-id']).toBe('sess-42');

    const del = server.requests.find((r) => r.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del?.headers['mcp-session-id']).toBe('sess-42');
  });

  it('TC-05: status is connected only after a successful handshake', async () => {
    server = await startMockMcpServer({});
    const tool = createMCPTool({ endpoint: server.url }, SCHEMA);
    expect(tool.getConnectionStatus()).toBe('disconnected');
    await tool.execute({ text: 'x' });
    expect(tool.getConnectionStatus()).toBe('connected');
    await tool.disconnect();
    expect(tool.getConnectionStatus()).toBe('disconnected');
  });

  it('TC-05: refused endpoint yields error status and a thrown connection failure', async () => {
    const tool = createMCPTool(
      { endpoint: 'http://127.0.0.1:1/mcp', timeout: 500, retries: 0 },
      SCHEMA,
    );
    await expect(tool.execute({ text: 'x' })).rejects.toThrow(ToolExecutionError);
    expect(tool.getConnectionStatus()).toBe('error');
  });
});
