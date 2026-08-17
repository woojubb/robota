/**
 * CORE-046 — the remote streaming route, served and spelled once.
 *
 * Before CORE-044 the client posted to `${baseUrl}/stream`, a second module named `/chat/stream`,
 * `app.ts` and this app's SPEC both claimed the route was inlined, and **no server here served
 * either spelling**. Every remote streaming call was a 404 wearing a capability's clothes. The suite
 * was green because the client tests drove a mocked `fetch`, and a mocked transport cannot notice
 * that the far end does not exist.
 *
 * So these cases go through `supertest` against the REAL app — the route table, not a mock. That is
 * the specific thing the item asked for, and the specific thing whose absence let the gap survive.
 *
 * The route streams SSE and the SERVER owns assembly: it calls `provider.chat(messages, {
 * onTextDelta })`, which is the contract every provider already implements ("stream internally, call
 * this per chunk, and still return the complete assembled message"). Tool-call fragments therefore
 * never reach the wire — which is why this can be restored at all, since the fragment assembler the
 * old client relied on was deleted with the second execution engine in CORE-042.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../app.js';

import type { IAIProvider, IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

const TEST_SECRET = 'stream-test-secret';
const bearer = (): string => `Bearer ${jwt.sign({ sub: 'test-user' }, TEST_SECRET)}`;

/**
 * A provider that streams internally and returns the ASSEMBLED message, exactly as
 * `IChatOptions.onTextDelta` requires — including a tool call, whose fragments it assembled itself.
 */
function streamingProvider(): IAIProvider {
  return {
    name: 'streamy',
    version: '1.0.0',
    async chat(_messages: TUniversalMessage[], options: IChatOptions): Promise<TUniversalMessage> {
      for (const piece of ['Hel', 'lo ', 'world']) {
        options.onTextDelta?.(piece);
      }
      return {
        id: 'assembled-1',
        role: 'assistant',
        content: 'Hello world',
        state: 'complete',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"weather"}' },
          },
        ],
      } as TUniversalMessage;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async *chatStream(): AsyncGenerator<TUniversalMessage> {
      // Reaching this would mean the route stopped using `chat()` + `onTextDelta`, which is the
      // contract that lets the SERVER own assembly — so it is worth seeing, not a silent no-op.
      yield* [];
      throw new Error('the route uses chat() + onTextDelta, per the post-CORE-042 contract');
    },
    supportsTools: () => true,
    validateConfig: () => true,
    async dispose(): Promise<void> {},
  } as unknown as IAIProvider;
}

/** Parse an SSE body into `[event, data]` pairs. */
function parseSse(body: string): Array<[string, string]> {
  const frames: Array<[string, string]> = [];
  for (const block of body.split('\n\n')) {
    const lines = block.split('\n');
    const event = lines
      .find((l) => l.startsWith('event:'))
      ?.slice('event:'.length)
      .trim();
    const data = lines
      .find((l) => l.startsWith('data:'))
      ?.slice('data:'.length)
      .trim();
    if (event !== undefined && data !== undefined) frames.push([event, data]);
  }
  return frames;
}

describe('CORE-046 — POST /api/v1/remote/chat/stream', () => {
  let previousSecret: string | undefined;
  beforeAll(() => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  const appWith = (): ReturnType<typeof createApp> =>
    createApp({ providers: { streamy: streamingProvider() } });

  it('is REGISTERED — the same request is a 404 against a server that does not serve it', async () => {
    const res = await request(appWith())
      .post('/api/v1/remote/chat/stream')
      .set('Authorization', bearer())
      .send({ provider: 'streamy', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  it('streams text deltas and one terminal assembled message', async () => {
    const res = await request(appWith())
      .post('/api/v1/remote/chat/stream')
      .set('Authorization', bearer())
      .send({ provider: 'streamy', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseSse(res.text);

    const deltas = frames.filter(([e]) => e === 'delta').map(([, d]) => JSON.parse(d).text);
    expect(deltas).toEqual(['Hel', 'lo ', 'world']);

    const messages = frames.filter(([e]) => e === 'message');
    expect(messages).toHaveLength(1);
    expect(frames.at(-1)?.[0]).toBe('done');
  });

  it('the tool call on the wire is ASSEMBLED, never a fragment', () => {
    // The reason this capability could be restored at all. The old client yielded raw provider
    // chunks and relied on an assembler that CORE-042 deleted; here the provider assembles before
    // returning, so a fragment cannot reach the wire to be corrupted.
    return request(appWith())
      .post('/api/v1/remote/chat/stream')
      .set('Authorization', bearer())
      .send({ provider: 'streamy', messages: [{ role: 'user', content: 'hi' }] })
      .then((res) => {
        const message = parseSse(res.text).find(([e]) => e === 'message');
        const parsed = JSON.parse(message![1]) as {
          toolCalls?: Array<{ function: { arguments: string } }>;
        };
        expect(parsed.toolCalls).toHaveLength(1);
        expect(JSON.parse(parsed.toolCalls![0].function.arguments)).toEqual({ q: 'weather' });
      });
  });

  it('is authenticated like the non-streaming route it mirrors (SEC-008)', async () => {
    const res = await request(appWith())
      .post('/api/v1/remote/chat/stream')
      .send({ provider: 'streamy', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(401);
  });

  it('refuses an invalid option rather than applying part of the request (CORE-044)', async () => {
    const res = await request(appWith())
      .post('/api/v1/remote/chat/stream')
      .set('Authorization', bearer())
      .send({
        provider: 'streamy',
        messages: [{ role: 'user', content: 'hi' }],
        options: { toolChoice: 'requried' },
      });

    expect(res.status).toBe(400);
    expect(res.body.rejected).toBeDefined();
  });

  it('rejects an unknown provider with the same contract as the non-streaming route', async () => {
    const res = await request(appWith())
      .post('/api/v1/remote/chat/stream')
      .set('Authorization', bearer())
      .send({ provider: 'nope', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(400);
  });
});
