/**
 * #3470 over the stateless HTTP host. It keeps no session state, so it can put a question only to
 * a 2026-07-28-era client, through input-required rounds: the call that asks is parked behind a
 * single-use `requestState`, and the client's retry carries the answer back to it. A 2025-era
 * client cannot be asked and keeps today's tool error.
 */
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpHttpHost, createMcpRemoteHttpHost } from '../mcp-http-host.js';
import { ASK_TOOL, PERMISSION_TOOL, createPromptingSession } from './prompting-session.js';

import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/client';

interface IHostOptions {
  askClient?: boolean;
}

interface IClientOptions {
  modern?: boolean;
  /** `false`: the client declares no elicitation and registers no handler. */
  elicitation?: false;
  /** Sends every request through this instead of the global fetch. */
  fetch?: typeof fetch;
  bearer?: string;
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
      capabilities: options.elicitation === false ? {} : { elicitation: { form: {} } },
      inputRequired: { autoFulfill: options.autoFulfill ?? true },
      ...(options.modern === false ? {} : { versionNegotiation: { mode: { pin: '2026-07-28' } } }),
    },
  );
  const asked: ElicitRequestFormParams[] = [];
  if (options.elicitation !== false) {
    client.setRequestHandler('elicitation/create', async (request) => {
      const params = request.params as ElicitRequestFormParams;
      asked.push(params);
      return (
        options.answer ?? (() => ({ action: 'accept', content: { decision: 'allow_once' } }))
      )(params);
    });
  }
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { Authorization: `Bearer ${options.bearer ?? endpoint.token}` } },
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
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
    fake.ask = {
      title: 'Pick one',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    };
    const { client } = await connect(endpoint, {
      answer: () => ({ action: 'accept', content: { answer: 'a' } }),
    });

    const result = await client.callTool({ name: ASK_TOOL.name, arguments: {} });

    expect(envelope(result).result).toEqual({ type: 'answer', values: ['a'] });
  });

  it('does not hold another driver’s prompt while its own submission waits in the queue', async () => {
    const { fake, endpoint } = await host({ askClient: true });
    const { client, asked } = await connect(endpoint);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const foreign = fake.foreignTurn(gate);

    const call = client.callTool({ name: 'agent_submit', arguments: { prompt: 'ls' } });
    await vi.waitFor(() => expect(fake.session.submit).toHaveBeenCalledOnce());
    open();

    expect(await foreign).toBe(false);
    expect(await call).toMatchObject({ content: [{ type: 'text', text: 'ran ls' }] });
    expect(asked).toHaveLength(1);
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

  it('ends a call parked on a question asked without a signal when the host stops', async () => {
    const { fake, served, endpoint } = await host({ askClient: true });
    const { client } = await connect(endpoint, { autoFulfill: false });

    const first = (await client.callTool(
      { name: ASK_TOOL.name, arguments: {} },
      { allowInputRequired: true },
    )) as unknown as { resultType?: string };
    expect(first.resultType).toBe('input_required');
    expect(fake.parkedIds()).toEqual(['a1']);

    await served.stop();

    expect(fake.parkedIds()).toEqual([]);
    expect(fake.session.resolveAsk).toHaveBeenCalledWith(
      'a1',
      { type: 'cancelled' },
      expect.stringMatching(/^mcp:/),
    );
  });

  it('still answers the retry when the call ended while it was parked', async () => {
    const { fake, endpoint } = await host({ askClient: true });
    const { client } = await connect(endpoint, { autoFulfill: false });

    const first = (await client.callTool(callWrite, { allowInputRequired: true })) as unknown as {
      requestState?: string;
    };
    fake.settleClosed('p1');
    await vi.waitFor(() => expect(fake.parkedIds()).toEqual([]));

    const retry = await client.callTool(
      {
        ...callWrite,
        inputResponses: { p1: { action: 'accept', content: { decision: 'allow_once' } } },
        requestState: first.requestState,
      } as never,
      { allowInputRequired: true },
    );

    expect(retry).toMatchObject({ isError: true, content: [{ text: DENIED_TEXT }] });
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

describe('HTTP, 2026-07-28 era: what is never sent', () => {
  it('never sends a masked ask; it is cancelled as today', async () => {
    const { fake, endpoint } = await host({ askClient: true });
    fake.ask = { title: 'API key', allowFreeText: true, masked: true };
    const { client, asked } = await connect(endpoint);

    const result = await client.callTool({ name: ASK_TOOL.name, arguments: {} });

    expect(asked).toEqual([]);
    expect(envelope(result).result).toEqual({ type: 'cancelled' });
  });
});

describe('HTTP, remote host: the operator switch reaches it', () => {
  const PUBLIC_URL = 'https://mcp.example.test/team/fixture-agent/mcp';

  it('asks a client admitted by an access token', async () => {
    const fake = createPromptingSession();
    const served = createMcpRemoteHttpHost({
      name: 'fixture-agent',
      version: '1',
      session: fake.session,
      askClient: true,
      authorization: {
        publicUrl: PUBLIC_URL,
        issuer: 'https://auth.example.test',
        scopes: ['mcp:use'],
        verifier: {
          verify: async (token) =>
            token === 'good' ? { admitted: true } : { admitted: false, refusal: 'bad-signature' },
        },
      },
    });
    const { listening } = await served.start();
    open.push(() => served.stop());
    const port = Number(listening.split(':').pop());
    // The host answers its public name only; send to the listener with that name.
    const viaListener: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = typeof init?.body === 'string' ? init.body : undefined;
      return new Promise<Response>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: url.pathname,
            method: init?.method ?? 'GET',
            headers: { ...headers, host: url.host },
          },
          (res) => {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') responseHeaders.set(key, value);
            }
            const stream = Readable.toWeb(res) as ReadableStream<Uint8Array>;
            resolve(
              new Response(res.statusCode === 204 ? null : stream, {
                status: res.statusCode ?? 0,
                headers: responseHeaders,
              }),
            );
          },
        );
        req.on('error', reject);
        req.end(body);
      });
    };
    const { client, asked } = await connect(
      { url: PUBLIC_URL, token: 'good' },
      { fetch: viaListener },
    );

    expect(await client.callTool(callWrite)).toMatchObject({ isError: false });
    expect(asked).toHaveLength(1);
  });
});

describe('HTTP: nothing is sent where the host cannot or may not ask', () => {
  it.each<[string, IHostOptions, IClientOptions]>([
    [
      'a 2025-era client, which a stateless host cannot ask',
      { askClient: true },
      { modern: false },
    ],
    ['the switch off, with a 2026-07-28 client', {}, {}],
    [
      'a 2026-07-28 client that declared no elicitation',
      { askClient: true },
      { elicitation: false },
    ],
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
