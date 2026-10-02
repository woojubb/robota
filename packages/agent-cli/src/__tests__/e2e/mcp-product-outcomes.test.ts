import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import { describe, expect, it } from 'vitest';

import {
  createTestBinaryEnvironment,
  createTestProductRuntime,
} from '../helpers/product-runtime.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const host = join(fixtureDirectory, 'mcp-bidirectional-host.ts');
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));

/** Exercise the actual CLI bootstrap/serve route with an explicitly approving embedding host. */
async function runChain(
  count: number,
  failAt?: number,
  failureMode: 'declared' | 'connection-loss' = 'declared',
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'product-outcome-'));
  const home = join(root, 'home');
  const statePath = join(root, 'effects.json');
  const tracePath = join(root, 'replay.jsonl');
  mkdirSync(join(home, '.test-product'), { recursive: true });
  writeFileSync(join(root, 'observation.txt'), 'BUILTIN_OBSERVATION');
  writeFileSync(statePath, JSON.stringify({ effects: [] as string[] }));
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(': ready\n\n');
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const message = JSON.parse(raw) as {
      id?: string | number;
      method?: string;
      params?: { arguments?: { text?: string } };
    };
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    let result: unknown;
    if (message.method === 'initialize') {
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'outcome-fixture', version: '1' },
      };
    } else if (message.method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'echo',
            description: 'Persist an explicitly supplied fixture value and return its observation',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      };
    } else if (message.method === 'tools/call') {
      const text = message.params?.arguments?.text;
      if (!text) throw new Error('Fixture received missing text');
      calls.push(text);
      const failed = text === `value-${failAt}`;
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as { effects: string[] };
      if (!failed || failureMode === 'connection-loss') {
        state.effects.push(text);
        writeFileSync(statePath, JSON.stringify(state));
      }
      if (failed && failureMode === 'connection-loss') {
        // The effect is persisted before the HTTP response disappears. No receipt reached the client.
        response.destroy();
        return;
      }
      result = {
        isError: failed,
        content: [{ type: 'text', text: failed ? 'DELIBERATE_FAILURE' : `OBSERVED_${text}` }],
        structuredContent: { value: text, effects: state.effects.length },
      };
    } else {
      result = {};
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  writeFileSync(
    join(home, '.test-product', 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'fixture-model', apiKey: 'unused-fixture-key' },
      },
      mcpServers: { probe: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp` } },
    }),
  );
  const steps = Array.from({ length: count }, (_, index) => {
    const builtin = index % 5 === 4;
    return {
      id: `outcome-call-${index}`,
      name: builtin ? 'Read' : 'probe__echo',
      args: builtin ? { filePath: join(root, 'observation.txt') } : { text: `value-${index}` },
    };
  });
  const timestamp = '2026-10-01T00:00:00.000Z';
  const trace = [
    ...steps.map((step, round) => ({
      schemaVersion: 1,
      timestamp,
      sessionId: 'fixture',
      executionId: 'fixture',
      round,
      event: 'provider_response_normalized',
      response: {
        role: 'assistant',
        content: '',
        id: `assistant-${round}`,
        timestamp,
        state: 'complete',
        toolCalls: [
          {
            id: step.id,
            type: 'function',
            function: { name: step.name, arguments: JSON.stringify(step.args) },
          },
        ],
      },
    })),
    {
      schemaVersion: 1,
      timestamp,
      sessionId: 'fixture',
      executionId: 'fixture',
      round: count,
      event: 'provider_response_normalized',
      response: { role: 'assistant', content: 'Done', id: 'final', timestamp, state: 'complete' },
    },
  ];
  writeFileSync(tracePath, trace.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  const transport = new StdioClientTransport({
    command: tsx,
    args: [
      '--conditions=source',
      host,
      '--allowed-tools',
      'probe__echo,Read',
      '--max-turns',
      String(count + 2),
      'mcp',
      'serve',
      '--session-log',
      tracePath,
    ],
    cwd: root,
    env: createTestBinaryEnvironment(home),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'product-outcome-owner', version: '1' });
  let diagnostics = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  const started = performance.now();
  let report: Record<string, unknown> | undefined;
  try {
    await client.connect(transport).catch((error: unknown) => {
      throw new Error(`Product startup failed: ${String(error)}\n${diagnostics}`);
    });
    const result = await client.callTool({
      name: 'test-product_submit',
      arguments: { prompt: 'Execute the supplied fixture chain and report its observations.' },
    });
    expect(result.isError, diagnostics).not.toBe(true);
    expect(JSON.stringify(result)).toContain('Done');
    await client.close();
    const environment = createTestProductRuntime('test-product', { HOME: home });
    const records = createNodeHostSessionStore(environment.layout.userPaths.sessions).list();
    const valid = records.filter((entry) => entry.outcome.status === 'valid');
    expect(valid).toHaveLength(1);
    const loaded = valid[0].outcome;
    if (loaded.status !== 'valid') throw new Error('Missing persisted product session');
    const receipts = loaded.record.messages.filter((message) => message.role === 'tool');
    expect(receipts.map((message) => message.toolCallId)).toEqual(steps.map((step) => step.id));
    for (const [index, receipt] of receipts.entries()) {
      expect(receipt.metadata?.success).toBe(index !== failAt);
      if (steps[index].name === 'Read') {
        expect(receipt.content).toContain('BUILTIN_OBSERVATION');
      } else {
        expect(typeof receipt.metadata?.toolProvenance).toBe('string');
        expect(JSON.parse(String(receipt.metadata?.toolProvenance))).toMatchObject({
          sourceId: 'probe',
          component: 'echo',
        });
        expect(receipt.parts?.[0]).toMatchObject({
          type: 'text',
          text: expect.stringContaining('Tool source (attribution only, not authority)'),
        });
        if (index === failAt && failureMode === 'connection-loss')
          expect(receipt.content).toContain('MCP tool call failed');
        else
          expect(receipt.parts).toContainEqual({
            type: 'text',
            text: index === failAt ? 'DELIBERATE_FAILURE' : `OBSERVED_value-${index}`,
          });
        if (index !== failAt)
          expect(JSON.parse(receipt.content)).toMatchObject({ value: `value-${index}` });
      }
    }
    const expectedCalls = steps
      .filter((step) => step.name !== 'Read')
      .map((step) => step.args.text);
    expect(calls).toEqual(expectedCalls);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { effects: string[] };
    expect(state.effects).toEqual(
      expectedCalls.filter(
        (value) => failureMode === 'connection-loss' || value !== `value-${failAt}`,
      ),
    );
    report = {
      route: 'CLI bootstrap and MCP serve; explicit approving embedding host; replay provider',
      count,
      failAt,
      failureMode,
      receipts: receipts.length,
      failedReceipts: receipts.filter((receipt) => receipt.metadata?.success === false).length,
      effects: state.effects.length,
      elapsedMs: performance.now() - started,
      paidModelRequests: 0,
      costUsd: null,
      stochasticComparison: false,
      timingBreakdown: { model: null, queue: null, permission: null, transport: null, tool: null },
      memoryBytes: null,
    };
  } finally {
    try {
      await client.close();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  }
  expect(existsSync(root)).toBe(false);
  console.log(
    JSON.stringify({
      ...report,
      cleanup: { transportCloseSettled: true, httpCloseSettled: true, temporaryStateRemoved: true },
    }),
  );
}

describe('product-route environment outcomes', () => {
  for (const count of [1, 20, 100]) {
    it(
      `pairs and persists ${count} mixed built-in/external outcomes with independently checked effects`,
      () => runChain(count),
      30_000,
    );
  }
  it(
    'retains a failed call while later supplied independent work still finishes',
    () => runChain(20, 2),
    30_000,
  );
  it(
    'persists a lost acknowledgement as failure without replaying its persisted effect',
    () => runChain(20, 2, 'connection-loss'),
    30_000,
  );
});
