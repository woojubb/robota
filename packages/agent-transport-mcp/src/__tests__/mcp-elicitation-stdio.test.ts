/**
 * #3470 over the real stdio carrier: with the operator's switch on and a v2 client that declared
 * form-mode elicitation, a permission or ask prompt raised by that client's own call is put to the
 * client and its answer settles the prompt; in every other case nothing is sent and the call ends
 * exactly as before.
 */
import { Client } from '@modelcontextprotocol/client';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpTransport } from '../mcp-transport.js';
import { ASK_TOOL, PERMISSION_TOOL, createPromptingSession } from './prompting-session.js';
import { createPeerTransport } from './stdio-peer.js';

import type {
  ClientCapabilities,
  ElicitRequestFormParams,
  ElicitResult,
} from '@modelcontextprotocol/client';

type TAnswer = (
  params: ElicitRequestFormParams,
  signal: AbortSignal,
) => ElicitResult | Promise<ElicitResult>;

interface IServeOptions {
  askClient?: boolean;
  /** The client's elicitation capability; `false` declares none and registers no handler. */
  elicitation?: false | NonNullable<ClientCapabilities['elicitation']>;
  answer?: TAnswer;
}

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (open.length) await open.pop()!();
});

const allowOnce: TAnswer = () => ({ action: 'accept', content: { decision: 'allow_once' } });

async function serve(options: IServeOptions = {}) {
  const fake = createPromptingSession();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = createMcpTransport({
    name: 'test',
    version: '1',
    stdin,
    stdout,
    ...(options.askClient !== undefined ? { askClient: options.askClient } : {}),
  });
  transport.attach(fake.session);
  await transport.start();
  const serverFrames: Array<{ id?: number; method?: string; params?: Record<string, unknown> }> =
    [];
  let pendingLine = '';
  stdout.on('data', (chunk: Buffer) => {
    const lines = (pendingLine + chunk.toString()).split('\n');
    pendingLine = lines.pop() ?? '';
    for (const line of lines) if (line.trim() !== '') serverFrames.push(JSON.parse(line));
  });
  const elicitation = options.elicitation ?? { form: {} };
  const client = new Client(
    { name: 'peer', version: '1' },
    { capabilities: elicitation === false ? {} : { elicitation } },
  );
  const asked: ElicitRequestFormParams[] = [];
  if (elicitation !== false) {
    client.setRequestHandler('elicitation/create', async (request, ctx) => {
      const params = request.params as ElicitRequestFormParams;
      asked.push(params);
      return (options.answer ?? allowOnce)(params, ctx.mcpReq.signal);
    });
  }
  await client.connect(createPeerTransport(stdout, stdin));
  open.push(async () => {
    await client.close();
    await transport.stop();
  });
  return { fake, client, asked, serverFrames };
}

type TFrames = Awaited<ReturnType<typeof serve>>['serverFrames'];

/**
 * Whether the server withdrew its elicitation request: it sent `notifications/cancelled` naming it.
 * Asserted on the wire because the v2 client SDK ignores a cancellation of request id 0 (it tests
 * the id for truthiness), and the first server-to-client request is id 0.
 */
function withdrewElicitation(frames: TFrames): boolean {
  const asked = frames.find((frame) => frame.method === 'elicitation/create');
  return frames.some(
    (frame) =>
      frame.method === 'notifications/cancelled' && frame.params?.requestId === asked?.id,
  );
}

function envelope(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

const DENIED = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        success: false,
        toolName: PERMISSION_TOOL.name,
        error: 'Permission denied',
      }),
    },
  ],
  isError: true,
};

const callWrite = { name: PERMISSION_TOOL.name, arguments: { path: 'notes.txt' } };

describe('stdio: a caller answers its own permission prompt', () => {
  it('allow once lets the tool run, answered in the call’s own name', async () => {
    const { fake, client, asked } = await serve({ askClient: true });

    const result = await client.callTool(callWrite);

    expect(result).toMatchObject({ isError: false });
    expect(envelope(result)).toMatchObject({ success: true, result: 'written' });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.message).toContain(PERMISSION_TOOL.name);
    expect(asked[0]?.message).toContain('notes.txt');
    expect(asked[0]?.requestedSchema).toEqual({
      type: 'object',
      properties: {
        decision: expect.objectContaining({ type: 'string', enum: ['allow_once', 'deny'] }),
      },
      required: ['decision'],
    });
    const options = vi.mocked(fake.session.invokeRuntimeTool).mock.calls[0]?.[2];
    expect(options).toMatchObject({ permissionInteraction: 'interactive' });
    const driverId = options?.driverId;
    expect(driverId).toMatch(/^mcp:\d+$/);
    expect(fake.session.resolvePermission).toHaveBeenCalledExactlyOnceWith('p1', true, driverId);
  });

  it.each<[string, TAnswer]>([
    ['deny', () => ({ action: 'accept', content: { decision: 'deny' } })],
    ['decline', () => ({ action: 'decline' })],
    ['cancel', () => ({ action: 'cancel' })],
    ['an answer that was not offered', () => ({ action: 'accept', content: { decision: 'allow_session' } })],
    [
      'a failing client',
      () => {
        throw new Error('client failed');
      },
    ],
  ])('%s leaves the existing permission error and grants nothing', async (_label, answer) => {
    const { fake, client, asked } = await serve({ askClient: true, answer });

    expect(await client.callTool(callWrite)).toEqual(DENIED);
    expect(asked).toHaveLength(1);
    expect(fake.session.resolvePermission).toHaveBeenCalledExactlyOnceWith(
      'p1',
      false,
      expect.stringMatching(/^mcp:/),
    );
  });

  it('asks the submitting caller about a permission its own turn raises', async () => {
    const { fake, client, asked } = await serve({ askClient: true });

    const result = await client.callTool({ name: 'agent_submit', arguments: { prompt: 'ls' } });

    expect(result).toEqual({ content: [{ type: 'text', text: 'ran ls' }] });
    expect(asked[0]?.message).toContain('Shell');
    expect(vi.mocked(fake.session.submit).mock.calls[0]?.[3]).toMatchObject({
      driverId: expect.stringMatching(/^mcp:\d+$/),
    });
  });
});

describe('stdio: a caller answers its own ask', () => {
  it('round-trips a single choice', async () => {
    const { fake, client, asked } = await serve({
      askClient: true,
      answer: () => ({ action: 'accept', content: { answer: 'b' } }),
    });
    fake.ask = { title: 'Pick one', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };

    const result = await client.callTool({ name: ASK_TOOL.name, arguments: {} });

    expect(envelope(result).result).toEqual({ type: 'answer', values: ['b'] });
    expect(asked[0]?.requestedSchema.properties.answer).toMatchObject({ enum: ['a', 'b'] });
  });

  it('round-trips a multiple choice and free text', async () => {
    const multi = await serve({
      askClient: true,
      answer: () => ({ action: 'accept', content: { answer: ['a', 'b'] } }),
    });
    multi.fake.ask = {
      title: 'Pick some',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      maxSelect: 2,
    };
    expect(
      envelope(await multi.client.callTool({ name: ASK_TOOL.name, arguments: {} })).result,
    ).toEqual({ type: 'answer', values: ['a', 'b'] });
    expect(multi.asked[0]?.requestedSchema.properties.answer).toMatchObject({
      type: 'array',
      maxItems: 2,
    });

    const text = await serve({
      askClient: true,
      answer: () => ({ action: 'accept', content: { text: 'hello' } }),
    });
    text.fake.ask = { title: 'Name it', allowFreeText: true };
    expect(
      envelope(await text.client.callTool({ name: ASK_TOOL.name, arguments: {} })).result,
    ).toEqual({ type: 'answer', values: [], text: 'hello' });
  });

  it('never sends a masked ask; it is cancelled as today', async () => {
    const { fake, client, asked } = await serve({ askClient: true });
    fake.ask = { title: 'API key', allowFreeText: true, masked: true };

    const result = await client.callTool({ name: ASK_TOOL.name, arguments: {} });

    expect(asked).toEqual([]);
    expect(envelope(result).result).toEqual({ type: 'cancelled' });
  });

  it('cancels an ask whose answer names something that was not offered', async () => {
    const { fake, client } = await serve({
      askClient: true,
      answer: () => ({ action: 'accept', content: { answer: 'z' } }),
    });
    fake.ask = { title: 'Pick one', options: [{ value: 'a', label: 'A' }] };

    const result = await client.callTool({ name: ASK_TOOL.name, arguments: {} });

    expect(envelope(result).result).toEqual({ type: 'cancelled' });
  });
});

describe('stdio: nothing is sent unless the operator and the client both opted in', () => {
  it.each<[string, IServeOptions]>([
    ['the switch is off', {}],
    ['the switch is explicitly off', { askClient: false }],
    ['the client declared no elicitation', { askClient: true, elicitation: false }],
    ['the client declared only URL mode', { askClient: true, elicitation: { url: {} } }],
  ])('when %s, the call ends exactly as before', async (_label, options) => {
    const { fake, client, asked } = await serve(options);

    expect(await client.callTool(callWrite)).toEqual(DENIED);
    expect(asked).toEqual([]);
    expect(fake.session.on).not.toHaveBeenCalled();
    expect(vi.mocked(fake.session.invokeRuntimeTool).mock.calls[0]?.[2]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });

  it('counts a bare elicitation declaration as form support', async () => {
    const { client, asked } = await serve({ askClient: true, elicitation: {} });

    expect(await client.callTool(callWrite)).toMatchObject({ isError: false });
    expect(asked).toHaveLength(1);
  });
});

describe('stdio: a question belongs to the call that raised it', () => {
  it('never routes another driver’s prompt to this client', async () => {
    const { fake, client, asked } = await serve({
      askClient: true,
      answer: (params) => {
        if (asked.length === 1) {
          fake.emit('permission_request', {
            id: 'foreign',
            toolName: 'Shell',
            toolArgs: { command: 'rm -rf /' },
            requesterDriverId: 'owner',
          });
        }
        return params.message.includes(PERMISSION_TOOL.name)
          ? { action: 'accept', content: { decision: 'allow_once' } }
          : { action: 'decline' };
      },
    });

    expect(await client.callTool(callWrite)).toMatchObject({ isError: false });
    expect(asked).toHaveLength(1);
    expect(fake.session.resolvePermission).not.toHaveBeenCalledWith(
      'foreign',
      expect.anything(),
      expect.anything(),
    );
  });

  it('does not hold another driver’s prompt while its own submission waits in the queue', async () => {
    // The session parks a prompt only while someone listens; a queued call that listened would
    // hold another caller's prompt that nobody here can answer instead of letting it fail closed.
    const { fake, client, asked } = await serve({ askClient: true });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const foreign = fake.foreignTurn(gate);

    const call = client.callTool({ name: 'agent_submit', arguments: { prompt: 'ls' } });
    await vi.waitFor(() => expect(fake.session.submit).toHaveBeenCalledOnce());
    open();

    expect(await foreign).toBe(false);
    expect(await call).toEqual({ content: [{ type: 'text', text: 'ran ls' }] });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.message).toContain('Allow Shell: ls?');
  });

  it('withdraws the question when the session settles the prompt first', async () => {
    const { fake, client, asked, serverFrames } = await serve({
      askClient: true,
      answer: () => new Promise<ElicitResult>(() => undefined),
    });

    const call = client.callTool(callWrite);
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    fake.settleClosed('p1');

    expect(await call).toEqual(DENIED);
    await vi.waitFor(() => expect(withdrewElicitation(serverFrames)).toBe(true));
    expect(fake.session.resolvePermission).not.toHaveBeenCalled();
  });

  it('withdraws the question when the client cancels its call', async () => {
    const { fake, client, asked, serverFrames } = await serve({
      askClient: true,
      answer: () => new Promise<ElicitResult>(() => undefined),
    });
    const cancellation = new AbortController();

    const call = client.callTool(callWrite, { signal: cancellation.signal });
    const rejected = expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    cancellation.abort();

    await rejected;
    await vi.waitFor(() => expect(withdrewElicitation(serverFrames)).toBe(true));
    await vi.waitFor(() => expect(fake.parkedIds()).toEqual([]));
  });
});
