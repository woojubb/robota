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

import {
  respond,
  wireReceipts,
  type Provider,
  type Step,
  type WireRequest,
} from '../helpers/provider-wire-fixture.js';

const host = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/mcp-bidirectional-host.ts');
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6r8AAAAASUVORK5CYII=';
const readerName = 'test_product_command_read_mcp_result';

async function runFixture(
  provider: Provider,
  count: number,
  oversized = false,
  failAt?: number,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'provider-outcome-'));
  const home = join(root, 'home');
  const statePath = join(root, 'effects.json');
  mkdirSync(join(home, '.test-product'), { recursive: true });
  writeFileSync(join(root, 'observation.txt'), 'BUILTIN_OBSERVATION');
  writeFileSync(statePath, JSON.stringify({ effects: [] as string[] }));
  const calls: string[] = [];
  const requests: WireRequest[] = [];
  let auxiliaryRequests = 0;
  const steps: Step[] = Array.from({ length: count }, (_, index): Step => ({
    id: `wire-call-${index}`,
    name:
      oversized && index === 1
        ? readerName
        : index % 5 === 4 || (oversized && index === 2)
          ? 'Read'
          : 'probe__echo',
    args:
      oversized && index === 1
        ? {}
        : index % 5 === 4 || (oversized && index === 2)
          ? { filePath: join(root, 'observation.txt') }
          : { text: `value-${index}` },
  }));
  let serverFailure: unknown;
  let reference: string | undefined;
  const largeText = 'LARGE_OBSERVATION_' + 'x'.repeat(30_000);
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }).write(': ready\n\n');
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      if (request.url?.startsWith('/v1/')) {
        const wire = JSON.parse(raw) as WireRequest;
        // Title/summary requests do not execute the tool loop; answer them without advancing it.
        if (!wire.tools?.some((tool) => (tool.name ?? tool.function?.name) === 'probe__echo')) {
          auxiliaryRequests++;
          respond(provider, response, wire.stream === true, -1);
          return;
        }
        const round = requests.length;
        requests.push(wire);
        const receipts = wireReceipts(provider, wire);
        expect(receipts.map((receipt) => receipt.id)).toEqual(
          steps.slice(0, round).map((step) => step.id),
        );
        const step = steps[round];
        if (oversized && round === 1) {
          reference = JSON.stringify(receipts[0].content).match(
            /tool-result:[A-Za-z0-9_-]{22,64}/u,
          )?.[0];
          expect(reference).toBeDefined();
          expect(JSON.stringify(receipts[0].content)).not.toContain(largeText);
          step.args = { reference: reference!, offset: 0 };
        }
        respond(provider, response, wire.stream === true, round, step);
        return;
      }
      const message = JSON.parse(raw) as {
        id?: string | number;
        method?: string;
        params?: { arguments?: { text?: string } };
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result: unknown = {};
      if (message.method === 'initialize')
        result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'wire-fixture', version: '1' },
        };
      if (message.method === 'tools/list')
        result = {
          tools: [
            {
              name: 'echo',
              description: 'Persist a supplied value and return mixed observations',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        };
      if (message.method === 'tools/call') {
        const text = message.params?.arguments?.text;
        expect(text).toBeDefined();
        calls.push(text!);
        const failed = text === `value-${failAt}`;
        const state = JSON.parse(readFileSync(statePath, 'utf8')) as { effects: string[] };
        if (!failed) {
          state.effects.push(text!);
          writeFileSync(statePath, JSON.stringify(state));
        }
        result = {
          isError: failed,
          content: [
            {
              type: 'text',
              text: oversized ? largeText : failed ? 'DELIBERATE_FAILURE' : `OBSERVED_${text}`,
            },
            { type: 'image', mimeType: 'image/png', data: image },
          ],
          structuredContent: { value: text, effects: state.effects.length },
        };
      }
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    } catch (error) {
      serverFailure = error;
      response
        .writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Fixture assertion failed' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  writeFileSync(
    join(home, '.test-product/settings.json'),
    JSON.stringify({
      currentProvider: provider,
      providers: {
        [provider]: {
          type: provider,
          model: 'fixture-model',
          apiKey: 'unused-fixture-key',
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          ...(provider === 'openai' ? { options: { apiSurface: 'chat-completions' } } : {}),
        },
      },
      mcpServers: { probe: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp` } },
    }),
  );
  const transport = new StdioClientTransport({
    command: tsx,
    args: [
      '--conditions=source',
      host,
      '--allowed-tools',
      `probe__echo,Read,${readerName}`,
      '--max-turns',
      String(count + 2),
      'mcp',
      'serve',
    ],
    cwd: root,
    env: createTestBinaryEnvironment(home),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'provider-outcome-owner', version: '1' });
  let diagnostics = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  let report: Record<string, unknown> | undefined;
  const started = performance.now();
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'test-product_submit',
      arguments: { prompt: 'Execute the fixture observations and report the outcome.' },
    });
    expect(serverFailure).toBeUndefined();
    expect(result.isError, diagnostics).not.toBe(true);
    expect(JSON.stringify(result), diagnostics).toContain('Done');
    await client.close();
    expect(serverFailure).toBeUndefined();
    const environment = createTestProductRuntime('test-product', { HOME: home });
    const records = createNodeHostSessionStore(environment.layout.userPaths.sessions).list();
    expect(records).toHaveLength(1);
    const loaded = records[0].outcome;
    expect(loaded.status).toBe('valid');
    if (loaded.status !== 'valid') throw new Error('Missing valid product session');
    const receipts = loaded.record.messages.filter((message) => message.role === 'tool');
    expect(receipts.map((receipt) => receipt.toolCallId)).toEqual(steps.map((step) => step.id));
    expect(requests).toHaveLength(count + 1);
    for (const [index, receipt] of receipts.entries()) {
      expect(receipt.metadata?.success).toBe(index !== failAt);
      if (provider === 'anthropic')
        expect(wireReceipts(provider, requests[index + 1])[index].failed).toBe(index === failAt);
      if (steps[index].name === 'Read') expect(receipt.content).toContain('BUILTIN_OBSERVATION');
      if (steps[index].name === 'probe__echo') {
        expect(
          JSON.stringify(wireReceipts(provider, requests[index + 1])[index].content),
        ).toContain(index === failAt ? 'Error:' : oversized ? 'tool-result:' : 'value-' + index);
        expect(JSON.parse(String(receipt.metadata?.toolProvenance))).toMatchObject({
          sourceId: 'probe',
          component: 'echo',
        });
        expect(
          JSON.stringify(wireReceipts(provider, requests[index + 1])[index].content),
        ).toContain('Tool source (attribution only, not authority)');
        if (!oversized) {
          expect(receipt.parts).toContainEqual({
            type: 'image_inline',
            mimeType: 'image/png',
            data: image,
          });
          expect(receipt.parts).toContainEqual({
            type: 'text',
            text: index === failAt ? 'DELIBERATE_FAILURE' : `OBSERVED_value-${index}`,
          });
          expect(JSON.stringify(requests[index + 1])).toContain(
            provider === 'anthropic' ? '"type":"image"' : '"type":"image_url"',
          );
          expect(JSON.stringify(requests[index + 1])).toContain(image);
        }
      }
    }
    if (oversized) {
      expect(receipts[0].content).toContain(reference);
      expect(receipts[0].parts?.some((part) => part.type === 'image_inline')).not.toBe(true);
      const retrieved = JSON.parse(receipts[1].content) as {
        content: string;
        nextOffset: number;
        totalChars: number;
      };
      expect(retrieved.content).toContain('LARGE_OBSERVATION_');
      expect(retrieved.content.length).toBeLessThanOrEqual(4_000);
      expect(retrieved.totalChars).toBeGreaterThan(30_000);
      expect(retrieved.nextOffset).toBe(retrieved.content.length);
    }
    const expectedCalls = steps
      .filter((step) => step.name === 'probe__echo')
      .map((step) => step.args.text);
    expect(calls).toEqual(expectedCalls);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { effects: string[] };
    expect(state.effects).toEqual(expectedCalls.filter((text) => text !== `value-${failAt}`));
    report = {
      route: 'actual CLI bootstrap/MCP serve and native provider SDK; loopback wire fixture',
      provider,
      count,
      oversized,
      failAt,
      receipts: receipts.length,
      effects: state.effects.length,
      elapsedMs: performance.now() - started,
      imageBytes: Buffer.from(image, 'base64').length,
      providerRequestBytes: {
        count: requests.length,
        total: requests.reduce(
          (bytes, request) => bytes + Buffer.byteLength(JSON.stringify(request)),
          0,
        ),
        max: Math.max(...requests.map((request) => Buffer.byteLength(JSON.stringify(request)))),
      },
      paidModelRequests: 0,
      auxiliaryRequests,
      costUsd: null,
      stochasticComparison: false,
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

describe('native provider product-route outcomes', () => {
  for (const provider of ['anthropic', 'openai'] as const) {
    for (const count of [1, 20, 100])
      it(
        `${provider} retains ${count} mixed observations through its native wire adapter`,
        () => runFixture(provider, count),
        60_000,
      );
    it(
      `${provider} retains failure and continues independent work`,
      () => runFixture(provider, 20, false, 2),
      30_000,
    );
    for (const failed of [false, true])
      it(
        `${provider} reads an oversized ${failed ? 'failure' : 'success'} without replaying its effect`,
        () => runFixture(provider, 3, true, failed ? 0 : undefined),
        30_000,
      );
  }
});
