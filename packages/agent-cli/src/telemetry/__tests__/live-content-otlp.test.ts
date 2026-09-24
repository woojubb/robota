import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ILivePromptContentBatch,
  ILivePromptContentItem,
  ILivePromptContentPolicy,
  ILivePromptTraceBatch,
} from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it, vi } from 'vitest';
import {
  LIVE_CONTENT_BATCH_BODY_BUDGET,
  createNodeOtlpLiveContentPort,
  projectLiveContentLogs,
} from '../live-content-otlp.js';
import { createNodeOtlpLiveLogPort } from '../live-log-otlp.js';
import { createLiveTelemetryResource } from '../live-resource.js';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';

const TRACE_ID = '1234567890abcdef1234567890abcdef';
const SPAN_ID = '1234567890abcdef';
const ENDED_AT = '2026-09-24T00:00:02.000Z';
const policy: ILivePromptContentPolicy = { userPrompts: true, assistantResponses: true, maxBytes: 16384 };
const resource = createLiveTelemetryResource();
const redaction = { getSecrets: () => ['sekret-value-1234'], cwd: '/nonexistent/repo', homedir: '/home/al' };

function item(text: string, extra: Partial<ILivePromptContentItem> = {}): ILivePromptContentItem {
  return { kind: 'user-prompt', text, originalBytes: Buffer.byteLength(text), truncated: false, ...extra };
}

function contentBatch(items: ILivePromptContentItem[]): ILivePromptContentBatch {
  return { schemaVersion: 1, root: { traceId: TRACE_ID, spanId: SPAN_ID, endedAt: ENDED_AT }, items };
}

const traceBatch: ILivePromptTraceBatch = {
  schemaVersion: 1, sessionId: 's', turnId: 't',
  root: { traceId: TRACE_ID, spanId: SPAN_ID, startedAt: '2026-09-24T00:00:00.000Z', endedAt: ENDED_AT, outcome: 'success' },
  children: [], omittedChildren: { provider: 0, tool: 0, permission: 0 },
};

async function withServer(
  handler: (request: IncomingMessage, body: Buffer, response: ServerResponse) => void,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    handler(request, Buffer.concat(chunks), response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const ok = (response: ServerResponse): void => {
  response.writeHead(200, { 'content-type': 'application/x-protobuf' });
  response.end();
};

const identity = (text: string) => ({ text, truncated: false });

describe('live content OTLP projection', () => {
  it('exports redacted text as a captured record on the prompt root', () => {
    const chunks = projectLiveContentLogs(contentBatch([
      item('key sekret-value-1234 in /nonexistent/repo/a.ts'),
      item('half', { kind: 'assistant-response', partial: true }),
    ]), new Date(ENDED_AT), resource, policy, (text, max, pre) => ({ text: `R(${text})`, truncated: pre && max > 0 }));
    expect(chunks).toHaveLength(1);
    const records = chunks[0]!;
    expect(records.map((record) => record.eventName)).toEqual(['robota.content.captured', 'robota.content.captured']);
    expect(records[0]!.spanContext).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID });
    expect(records[0]!.body).toBe('R(key sekret-value-1234 in /nonexistent/repo/a.ts)');
    expect(records[0]!.attributes).toEqual({
      'robota.content.kind': 'user-prompt',
      'robota.content.truncated': false,
      'robota.content.original_bytes': 47,
    });
    expect(records[1]!.attributes).toEqual({
      'robota.content.kind': 'assistant-response',
      'robota.content.truncated': false,
      'robota.content.original_bytes': 4,
      'robota.content.partial': true,
    });
  });

  it('exports a tool item on its tool span with its call, a safe name and outcome', () => {
    const tool = (callId: string, name: string, outcome: 'success' | 'failure' | 'denied', spanId?: string) =>
      ({ callId, name, outcome, ...(spanId ? { spanId } : {}) });
    const chunks = projectLiveContentLogs(contentBatch([
      item('{"command":"ls"}', { kind: 'tool-arguments', tool: tool('call_1', 'Bash', 'success', 'aaaaaaaaaaaaaaaa') }),
      item('out', { kind: 'tool-output', tool: tool('call_1', 'Bash', 'success', 'aaaaaaaaaaaaaaaa') }),
      item('{}', { kind: 'tool-arguments', tool: tool('call 2\n', 'mcp__srv__do it', 'denied') }),
      item('', { kind: 'tool-output', tool: tool('call_3', 'x'.repeat(129), 'failure', 'not-a-span') }),
    ]), new Date(ENDED_AT), resource, policy, identity);
    const records = chunks[0]!;
    expect(records[0]!.spanContext).toMatchObject({ traceId: TRACE_ID, spanId: 'aaaaaaaaaaaaaaaa' });
    expect(records[0]!.attributes).toEqual({
      'robota.content.kind': 'tool-arguments',
      'robota.content.truncated': false,
      'robota.content.original_bytes': 16,
      'robota.tool.call_id': 'call_1',
      'robota.tool.name': 'Bash',
      'robota.tool.outcome': 'success',
    });
    expect(records[1]!.attributes).toMatchObject({ 'robota.content.kind': 'tool-output', 'robota.tool.call_id': 'call_1' });
    // An unsafe call ID is left out, an unsafe name becomes `unknown`, a bad span falls back to the root.
    expect(records[2]!.spanContext).toMatchObject({ spanId: SPAN_ID });
    expect(records[2]!.attributes).toEqual({
      'robota.content.kind': 'tool-arguments',
      'robota.content.truncated': false,
      'robota.content.original_bytes': 2,
      'robota.tool.name': 'unknown',
      'robota.tool.outcome': 'denied',
    });
    expect(records[3]!.spanContext).toMatchObject({ spanId: SPAN_ID });
    expect(records[3]!.attributes).toMatchObject({ 'robota.tool.name': 'unknown', 'robota.tool.outcome': 'failure' });
  });

  it('splits one batch into requests of at most 64 items and the post-redaction budget, in order', () => {
    const big = 'x'.repeat(16384);
    const bigChunks = projectLiveContentLogs(contentBatch(Array.from({ length: 70 }, () => item(big))),
      new Date(ENDED_AT), resource, policy, identity);
    expect(bigChunks.map((chunk) => chunk.length)).toEqual([48, 22]);
    for (const chunk of bigChunks) {
      const bytes = chunk.reduce((sum, record) => sum + Buffer.byteLength(String(record.body)), 0);
      expect(bytes).toBeLessThanOrEqual(LIVE_CONTENT_BATCH_BODY_BUDGET);
    }
    const small = projectLiveContentLogs(
      contentBatch(Array.from({ length: 130 }, (_, index) => item(`item ${index}`))),
      new Date(ENDED_AT), resource, policy, identity);
    expect(small.map((chunk) => chunk.length)).toEqual([64, 64, 2]);
    expect(small.flat().map((record) => record.body)).toEqual(Array.from({ length: 130 }, (_, index) => `item ${index}`));
  });

  it('exports at most one turn of items, counting the rest by kind in the last request', () => {
    const items = [
      item('p'), item('r', { kind: 'assistant-response' }),
      ...Array.from({ length: 140 }, (_, index) => item(`a${index}`, {
        kind: index % 2 === 0 ? 'tool-arguments' : 'tool-output',
        tool: { callId: `c${index >> 1}`, name: 'Read', outcome: 'success' },
      })),
    ];
    const chunks = projectLiveContentLogs({ ...contentBatch(items), omitted: { 'tool-arguments': 3, 'tool-output': 1 } },
      new Date(ENDED_AT), resource, policy, identity);
    const captured = chunks.flat().filter((record) => record.eventName === 'robota.content.captured');
    expect(captured).toHaveLength(130);
    expect(chunks.slice(0, -1).flat().some((record) => record.eventName === 'robota.content.omitted')).toBe(false);
    const omitted = chunks.at(-1)!.at(-1)!;
    expect(omitted.eventName).toBe('robota.content.omitted');
    expect(omitted.body).toBeUndefined();
    expect(omitted.attributes).toEqual({
      'robota.telemetry.omitted_content_items': 16,
      'robota.telemetry.omitted_content_items.tool_arguments': 9,
      'robota.telemetry.omitted_content_items.tool_output': 7,
    });
  });

  it('never lets the omission record push a request past 64 records', () => {
    const chunks = projectLiveContentLogs(
      { ...contentBatch(Array.from({ length: 64 }, (_, index) => item(`i${index}`))), omitted: { 'tool-output': 1 } },
      new Date(ENDED_AT), resource, policy, identity);
    expect(chunks.map((chunk) => chunk.length)).toEqual([64, 1]);
    expect(chunks[1]![0]!.eventName).toBe('robota.content.omitted');
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(64);
  });

  it('drops only the item whose redaction threw', () => {
    const chunks = projectLiveContentLogs(contentBatch([item('boom'), item('fine')]),
      new Date(ENDED_AT), resource, policy, (text) => {
        if (text === 'boom') throw new Error('redactor bug');
        return { text, truncated: false };
      });
    expect(chunks.flat().map((record) => [record.eventName, record.body])).toEqual([
      ['robota.content.captured', 'fine'],
      ['robota.content.omitted', undefined],
    ]);
    expect(chunks.flat().at(-1)!.attributes).toEqual({
      'robota.telemetry.omitted_content_items': 1,
      'robota.telemetry.omitted_content_items.user_prompt': 1,
    });
  });

  it('exports only the omission count when the batch has no redactor', () => {
    const chunks = projectLiveContentLogs(contentBatch([item('secret text'), item('more')]),
      new Date(ENDED_AT), resource, policy, undefined);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!).toHaveLength(1);
    expect(chunks[0]![0]!.eventName).toBe('robota.content.omitted');
    expect(JSON.stringify(chunks)).not.toContain('secret text');
  });

  it('exports an omission record alone when the framework omitted everything', () => {
    const chunks = projectLiveContentLogs({ ...contentBatch([]), omitted: { 'tool-output': 2 } },
      new Date(ENDED_AT), resource, policy, identity);
    expect(chunks.flat().map((record) => record.eventName)).toEqual(['robota.content.omitted']);
  });
});

describe('live content OTLP delivery', () => {
  it('re-reads the secrets for every batch and drops the whole batch when that fails', async () => {
    const bodies: string[] = [];
    let calls = 0;
    const onFailure = vi.fn();
    await withServer((_request, body, response) => { bodies.push(body.toString('utf8')); ok(response); }, async (base) => {
      const port = createNodeOtlpLiveContentPort({
        endpoint: `${base}/v1/logs`, resource, policy, onFailure,
        redaction: {
          ...redaction,
          getSecrets: () => {
            calls += 1;
            if (calls === 2) throw new Error('unreadable');
            return [`secret-number-${calls}`];
          },
        },
      });
      port.enqueue(contentBatch([item('has secret-number-1')]));
      port.enqueue(contentBatch([item('dropped secret-number-2')]));
      port.enqueue(contentBatch([item('has secret-number-3')]));
      await port.shutdown();
    });
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toContain('has [redacted]');
    expect(bodies[1]).toContain('robota.content.omitted');
    expect(bodies[1]).not.toContain('dropped');
    expect(bodies[2]).toContain('has [redacted]');
    expect(bodies.join('')).not.toMatch(/secret-number/u);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('content-delivery-failed');
  });

  it('a failing content export never clears content-free logs', async () => {
    const paths: string[] = [];
    await withServer((request, body, response) => {
      paths.push(body.toString('utf8').includes('robota.content.captured') ? 'content' : 'logs');
      if (body.toString('utf8').includes('robota.content.captured')) {
        response.writeHead(500);
        response.end();
        return;
      }
      void request;
      ok(response);
    }, async (base) => {
      const onFailure = vi.fn();
      const logs = createNodeOtlpLiveLogPort(`${base}/v1/logs`, onFailure, resource);
      const content = createNodeOtlpLiveContentPort({
        endpoint: `${base}/v1/logs`, resource, policy, redaction, onFailure,
      });
      content.enqueue(contentBatch([item('first')]));
      content.enqueue(contentBatch([item('second')]));
      logs.enqueue(traceBatch);
      logs.enqueue(traceBatch);
      await Promise.all([content.shutdown(), logs.shutdown()]);
      expect(onFailure.mock.calls).toEqual([['content-delivery-failed']]);
    });
    // The second content batch was cleared with the failed first one; both log batches arrived.
    expect(paths.filter((path) => path === 'content')).toHaveLength(1);
    expect(paths.filter((path) => path === 'logs')).toHaveLength(2);
  });

  it('a failing content-free export never clears content', async () => {
    const paths: string[] = [];
    await withServer((_request, body, response) => {
      const isContent = body.toString('utf8').includes('robota.content.captured');
      paths.push(isContent ? 'content' : 'logs');
      if (!isContent) {
        response.writeHead(500);
        response.end();
        return;
      }
      ok(response);
    }, async (base) => {
      const onFailure = vi.fn();
      const logs = createNodeOtlpLiveLogPort(`${base}/v1/logs`, onFailure, resource);
      const content = createNodeOtlpLiveContentPort({
        endpoint: `${base}/v1/logs`, resource, policy, redaction, onFailure,
      });
      logs.enqueue(traceBatch);
      logs.enqueue(traceBatch);
      content.enqueue(contentBatch([item('first')]));
      content.enqueue(contentBatch([item('second')]));
      await Promise.all([content.shutdown(), logs.shutdown()]);
      expect(onFailure.mock.calls).toEqual([['delivery-failed']]);
    });
    expect(paths.filter((path) => path === 'content')).toHaveLength(2);
    expect(paths.filter((path) => path === 'logs')).toHaveLength(1);
  });

  it('sends a large batch as several requests, and abandons the rest of it and the queue when one fails', async () => {
    const bodies: string[] = [];
    const onFailure = vi.fn();
    let requests = 0;
    await withServer((_request, body, response) => {
      requests += 1;
      bodies.push(body.toString('utf8'));
      if (requests === 2) {
        response.writeHead(500);
        response.end();
        return;
      }
      ok(response);
    }, async (base) => {
      const port = createNodeOtlpLiveContentPort({
        endpoint: `${base}/v1/logs`, resource, policy, redaction, onFailure,
      });
      const many = (tag: string) => contentBatch(Array.from({ length: 130 }, (_, index) => item(`${tag}-${index}`)));
      port.enqueue({ ...many('first'), omitted: { 'tool-output': 1 } });
      port.enqueue(many('second'));
      await port.shutdown();
    });
    // The first request went through, the second failed: the third request of the batch and the
    // whole queued second batch were abandoned, so its omission record was lost with them.
    expect(requests).toBe(2);
    expect(bodies[0]).toContain('first-0');
    expect(bodies[1]).toContain('first-64');
    expect(bodies.join('')).not.toMatch(/first-129|second-|robota\.content\.omitted/u);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('content-delivery-failed');
  });

  it('bounds its own queue independently of the content-free logs', async () => {
    const content = createNodeOtlpLiveContentPort({
      endpoint: 'http://127.0.0.1:9/v1/logs', resource, policy, redaction,
    });
    const logs = createNodeOtlpLiveLogPort('http://127.0.0.1:9/v1/logs', undefined, resource);
    // The worker takes the first batch at once, so four more fill the queue.
    for (let index = 0; index < 5; index += 1) content.enqueue(contentBatch([item('x')]));
    expect(() => content.enqueue(contentBatch([item('x')]))).toThrow(/queue/u);
    expect(() => logs.enqueue(traceBatch)).not.toThrow();
    await Promise.all([content.shutdown(), logs.shutdown()]);
  });
});

describe('configured content capture', () => {
  const base = {
    ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'otlp', ROBOTA_TELEMETRY_TRACES: 'console',
    ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
    ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1',
  };

  it('sends content in its own POST to the logs destination with its headers, masking header values, never to the console', async () => {
    const requests: Array<{ path: string; auth: string | undefined; body: string }> = [];
    const consoleLines: string[] = [];
    await withServer((request, body, response) => {
      requests.push({ path: request.url ?? '', auth: request.headers['authorization'], body: body.toString('utf8') });
      ok(response);
    }, async (url) => {
      const port = createConfiguredNodeOtlpLiveTelemetryPort({
        ...base,
        ROBOTA_TELEMETRY_OTLP_ENDPOINT: url,
        ROBOTA_TELEMETRY_OTLP_HEADERS: 'authorization=Bearer%20collector-token-xyz',
      }, undefined, (line) => void consoleLines.push(line), undefined, undefined, redaction);
      expect(port?.content?.policy).toEqual({
        userPrompts: true, assistantResponses: false, toolArguments: false, toolOutput: false, maxBytes: 2048,
      });
      port!.enqueue(traceBatch);
      port!.content!.enqueue(contentBatch([item('token collector-token-xyz and sekret-value-1234')]));
      await port!.shutdown();
    });
    const content = requests.filter((request) => request.body.includes('robota.content.captured'));
    const logs = requests.filter((request) => request.body.includes('robota.prompt_execution.completed'));
    expect(content).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(content[0]!.path).toBe('/v1/logs');
    expect(content[0]!.auth).toBe('Bearer collector-token-xyz');
    expect(content[0]!.body).toContain('token [redacted] and [redacted]');
    expect(content[0]!.body).not.toContain('collector-token-xyz');
    expect(logs[0]!.body).not.toContain('token');
    expect(consoleLines.join('')).not.toMatch(/token|sekret|content\.captured/u);
  });
});
