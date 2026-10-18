/**
 * #3470 over the stateless HTTP host. It keeps no session state, so it can put a question only to
 * a 2026-07-28-era client, through input-required rounds: the call that asks is parked behind a
 * single-use `requestState`, and the client's retry carries the answer back to it. A 2025-era
 * client cannot be asked and keeps today's tool error.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpHttpHost } from '../mcp-http-host.js';
import { ASK_TOOL, PERMISSION_TOOL, createPromptingSession } from './prompting-session.js';

import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/client';

interface IHostOptions {
  askClient?: boolean;
}

interface IClientOptions {
  modern?: boolean;
  /** `false`: manual mode, an input-required result is handed back to the test. */
  autoFulfill?: boolean;
  answer?: (params: ElicitRequestFormParams) => ElicitResult;
}

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (open.length) await open.pop()!();
});

async function host(options: IHostOptions = {}) {
  const fake = createPromptingSession();
  const served = createMcpHttpHost({
    name: 'fixture-agent',
    version: '1',
    session: fake.session,
    ...(options.askClient !== undefined ? { askClient: options.askClient } : {}),
  });
  const endpoint = await served.start();
  open.push(() => served.stop());
  return { fake, served, endpoint };
}

async function connect(
  endpoint: { url: string; token: string },
  options: IClientOptions = {},
): Promise<{ client: Client; asked: ElicitRequestFormParams[] }> {
  const client = new Client(
    { name: 'http-elicitation-test', version: '1' },
    {
      capabilities: { elicitation: { form: {} } },
      inputRequired: { autoFulfill: options.autoFulfill ?? true },
      ...(options.modern === false ? {} : { versionNegotiation: { mode: { pin: '2026-07-28' } } }),
    },
  );
  const asked: ElicitRequestFormParams[] = [];
  client.setRequestHandler('elicitation/create', async (request) => {
    const params = request.params as ElicitRequestFormParams;
    asked.push(params);
    return (options.answer ?? (() => ({ action: 'accept', content: { decision: 'allow_once' } })))(
      params,
    );
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } },
    }),
  );
  open.push(() => client.close());
  return { client, asked };
}

function envelope(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

const callWrite = { name: PERMISSION_TOOL.name, arguments: { path: 'notes.txt' } };
const DENIED_TEXT = JSON.stringify({
  success: false,
  toolName: PERMISSION_TOOL.name,
  error: 'Permission denied',
});

describe('HTTP, 2026-07-28 era: a caller answers through input-required rounds', () => {
  it('allow once lets the one parked invocation run', async () => {
    const { fake, endpoint } = await host({ askClient: true });
    const { client, asked } = await connect(endpoint);

    const result = await client.callTool(callWrite);

    expect(client.getProtocolEra()).toBe('modern');
    expect(result).toMatchObject({ isError: false });
    expect(envelope(result)).toMatchObject({ success: true, result: 'written' });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.requestedSchema.properties.decision).toMatchObject({
      enum: ['allow_once', 'deny'],
    });
    expect(fake.session.invokeRuntimeTool).toHaveBeenCalledTimes(1);
    expect(fake.session.resolvePermission).toHaveBeenCalledExactlyOnceWith(
      'p1',
      true,
      expect.stringMatching(/^mcp:\d+$/),
    );
  });

  it.each<[string, ElicitResult]>([
    ['deny', { action: 'accept', content: { decision: 'deny' } }],
    ['decline', { action: 'decline' }],
    ['cancel', { action: 'cancel' }],
  ])('%s leaves the existing permission error', async (_label, answer) => {
    const { fake, endpoint } = await host({ askClient: true });
    const { client, asked } = await connect(endpoint, { answer: () => answer });

    const result = await client.callTool(callWrite);

    expect(result).toMatchObject({ isError: true, content: [{ text: DENIED_TEXT }] });
    expect(asked).toHaveLength(1);
    expect(fake.session.invokeRuntimeTool).toHaveBeenCalledTimes(1);
  });

  it('round-trips an ask as a form', async () => {
    const { fake, endpoint } = await host({ askClient: true });
    fake.ask = { title: 'Pick one', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };
    const { client } = await connect(endpoint, {
      answer: () => ({ action: 'accept', content: { answer: 'a' } }),
    });

    const result = await client.callTool({ name: ASK_TOOL.name, arguments: {} });

    expect(envelope(result).result).toEqual({ type: 'answer', values: ['a'] });
  });

  it('accepts a request state only once, and only one it issued', async () => {
    const { fake, endpoint } = await host({ askClient: true });
    const { client } = await connect(endpoint, { autoFulfill: false });

    const first = (await client.callTool(callWrite, { allowInputRequired: true })) as unknown as {
      resultType?: string;
      requestState?: string;
      inputRequests?: Record<string, unknown>;
    };
    expect(first.resultType).toBe('input_required');
    expect(Object.keys(first.inputRequests ?? {})).toEqual(['p1']);
    const requestState = first.requestState!;
    const answer = { p1: { action: 'accept', content: { decision: 'allow_once' } } };
    const retry = (state: string) =>
      client.callTool({ ...callWrite, inputResponses: answer, requestState: state } as never, {
        allowInputRequired: true,
      });

    await expect(retry(`${requestState}x`)).rejects.toThrow(/Invalid or expired requestState/);
    expect(fake.session.resolvePermission).not.toHaveBeenCalled();
    expect(envelope(await retry(requestState))).toMatchObject({ success: true });
    await expect(retry(requestState)).rejects.toThrow(/Invalid or expired requestState/);
    expect(fake.session.invokeRuntimeTool).toHaveBeenCalledTimes(1);
  });

  it('ends a parked call when the host stops', async () => {
    const { fake, served, endpoint } = await host({ askClient: true });
    const { client } = await connect(endpoint, { autoFulfill: false });

    const first = (await client.callTool(callWrite, { allowInputRequired: true })) as unknown as {
      resultType?: string;
    };
    expect(first.resultType).toBe('input_required');
    expect(fake.parkedIds()).toEqual(['p1']);
    const signal = vi.mocked(fake.session.invokeRuntimeTool).mock.calls[0]?.[2]?.signal;

    await served.stop();

    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(fake.parkedIds()).toEqual([]));
  });
});

describe('HTTP: nothing is sent where the host cannot or may not ask', () => {
  it.each<[string, IHostOptions, IClientOptions]>([
    ['a 2025-era client, which a stateless host cannot ask', { askClient: true }, { modern: false }],
    ['the switch off, with a 2026-07-28 client', {}, {}],
  ])('%s keeps the existing error', async (_label, hostOptions, clientOptions) => {
    const { fake, endpoint } = await host(hostOptions);
    const { client, asked } = await connect(endpoint, clientOptions);

    const result = await client.callTool(callWrite);

    expect(result).toMatchObject({ isError: true, content: [{ text: DENIED_TEXT }] });
    expect(asked).toEqual([]);
    expect(fake.session.on).not.toHaveBeenCalled();
    expect(vi.mocked(fake.session.invokeRuntimeTool).mock.calls[0]?.[2]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });
});
