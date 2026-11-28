import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  countLeaksInPath,
  countLeaksInTexts,
  holdCredential,
} from './outcome-coding-credential.js';
import { createLedgerGate } from './outcome-coding-gate.js';
import {
  catalogListsModel,
  checkCredits,
  createGatewayUpstream,
  fetchEndpointListing,
  lookupGeneration,
  requestOnce,
} from './outcome-coding-gateway.js';
import { SpendLedger, type ILedgerHeader } from './outcome-coding-ledger.js';
import { basisCovers, parseEndpointListing } from './outcome-coding-pricing.js';
import type { TJson } from './outcome-coding-protocol.js';
import { createCodingRelay, type IRelayPolicy } from './outcome-coding-relay.js';
import { forcedRequestFields } from './outcome-coding-settings.js';

const KEY = 'fake-key-live-test-0123456789';
const MODEL = 'pinned-model';
const PROVIDER = 'route-a';

type TChatMode =
  | {
      readonly kind: 'receipt';
      readonly patch?: Record<string, unknown>;
      readonly usage?: Record<string, unknown>;
      readonly generation?: Record<string, unknown>;
    }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'hang' }
  | { readonly kind: 'destroy' }
  | { readonly kind: 'text'; readonly text: string };

interface IFakeGateway {
  base: string;
  endpoint: string;
  readonly chatBodies: string[];
  readonly chatAuth: (string | undefined)[];
  readonly allPaths: string[];
  mode: TChatMode;
  listing: unknown;
  credits: unknown;
  readonly generations: Map<string, Record<string, unknown>>;
  readonly polls: string[];
  lagPolls: number;
  generationStatus: number | undefined;
  close(): Promise<void>;
}

const LISTING: TJson = {
  data: {
    endpoints: [
      { provider_name: PROVIDER, pricing: { prompt: '0.000001', completion: '0.000004' } },
      {
        provider_name: PROVIDER,
        pricing: { prompt: '0.0000012', completion: '0.000004' },
        regions: [{ pricing: { prompt: '0.000002', completion: '0.000005' } }],
      },
      { provider_name: 'route-b', pricing: { prompt: '1', completion: '1' } },
    ],
  },
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function startGateway(): Promise<IFakeGateway> {
  const gateway: IFakeGateway = {
    base: '',
    endpoint: '',
    chatBodies: [],
    chatAuth: [],
    allPaths: [],
    mode: { kind: 'receipt' },
    listing: LISTING,
    credits: { balance: '3.5', total_used: '1.5', token_pass: null },
    generations: new Map(),
    polls: [],
    lagPolls: 0,
    generationStatus: undefined,
    close: async () => undefined,
  };
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = request.url ?? '';
      gateway.allPaths.push(`${request.method} ${path}`);
      if (request.method === 'GET' && path === '/v1/models') {
        return json(response, 200, { data: [{ id: MODEL }, { id: 'other-model' }] });
      }
      if (request.method === 'GET' && path === `/v1/models/${MODEL}/endpoints`) {
        return json(response, 200, gateway.listing);
      }
      if (request.method === 'GET' && path === '/v1/credits') {
        return json(response, 200, gateway.credits);
      }
      if (request.method === 'GET' && path.startsWith('/v1/generation?id=')) {
        const id = decodeURIComponent(path.slice('/v1/generation?id='.length));
        gateway.polls.push(id);
        if (gateway.generationStatus !== undefined)
          return json(response, gateway.generationStatus, { error: 'refused' });
        const record = gateway.generations.get(id);
        if (record === undefined || gateway.polls.length <= gateway.lagPolls)
          return json(response, 404, { error: 'not found' });
        return json(response, 200, { data: record });
      }
      if (request.method === 'POST' && path === '/v1/chat/completions') {
        gateway.chatBodies.push(Buffer.concat(chunks).toString('utf8'));
        gateway.chatAuth.push(request.headers.authorization);
        const mode = gateway.mode;
        if (mode.kind === 'hang') return;
        if (mode.kind === 'destroy') return request.socket.destroy();
        if (mode.kind === 'status') {
          return json(response, mode.status, { error: { message: 'server trouble' } });
        }
        if (mode.kind === 'text') {
          response.writeHead(200, { 'content-type': 'text/plain' });
          return response.end(mode.text);
        }
        const generationId = `gen_t${gateway.chatBodies.length}`;
        const usage = { prompt_tokens: 40, completion_tokens: 12, cost: 0.0001, ...mode.usage };
        gateway.generations.set(generationId, {
          id: generationId,
          model: MODEL,
          provider_name: PROVIDER,
          total_cost: usage.cost,
          ...mode.generation,
        });
        return json(response, 200, {
          id: generationId,
          generationId,
          object: 'chat.completion',
          model: MODEL,
          created: 1,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
          ...mode.patch,
          usage,
        });
      }
      return json(response, 404, { error: 'not found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  gateway.base = `http://127.0.0.1:${port}/v1`;
  gateway.endpoint = `${gateway.base}/chat/completions`;
  gateway.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return gateway;
}

interface ITest {
  readonly gateway: IFakeGateway;
  readonly dir: string;
  readonly ledger: SpendLedger;
  readonly ledgerPath: string;
  readonly relay: ReturnType<typeof createCodingRelay>;
}

function header(patch: Partial<ILedgerHeader> = {}): ILedgerHeader {
  const { rates } = parseEndpointListing(LISTING, PROVIDER);
  return {
    ceilingMicros: 2_000_000,
    callCap: 400,
    basis: rates,
    commit: 'abc123',
    route: { provider: PROVIDER, model: MODEL },
    maxOutputTokens: 8192,
    templateAllowanceTokens: 2_000,
    ...patch,
  };
}

async function withRun(
  run: (context: ITest) => Promise<void>,
  options: { header?: Partial<ILedgerHeader>; upstreamTimeoutMs?: number } = {},
): Promise<void> {
  const gateway = await startGateway();
  const dir = mkdtempSync(join(tmpdir(), 'live-test-'));
  const ledgerPath = join(dir, 'ledger.jsonl');
  const ledger = SpendLedger.create(ledgerPath, header(options.header));
  const policy: IRelayPolicy = {
    endpoint: gateway.endpoint,
    model: MODEL,
    allowedTools: ['Read'],
    forced: forcedRequestFields(),
    maxBodyBytes: 100_000,
    deadlineAt: Date.now() + 60_000,
    upstreamTimeoutMs: options.upstreamTimeoutMs ?? 5_000,
  };
  const credential = holdCredential(KEY);
  const clock = fakeClock();
  const relay = createCodingRelay(
    policy,
    createGatewayUpstream({ endpoint: gateway.endpoint, credential }),
    Date.now,
    createLedgerGate(ledger, async (body) => {
      const id = (body as { generationId?: string }).generationId;
      return id === undefined
        ? undefined
        : await lookupGeneration(
            { baseUrl: gateway.base, timeoutMs: 2_000 },
            credential,
            id,
            clock,
          );
    }),
  );
  try {
    await run({ gateway, dir, ledger, ledgerPath, relay });
  } finally {
    ledger.close();
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A clock the wait advances by itself, so a bounded lookup costs no real time. */
function fakeClock(): {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly slept: number[];
} {
  let time = 0;
  const slept: number[] = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      slept.push(ms);
      time += ms;
    },
    slept,
  };
}

function request(context: ITest, id = 1, text = 'hello') {
  return context.relay.handle({
    id,
    url: context.gateway.endpoint,
    body: { model: MODEL, messages: [{ role: 'user', content: text }] },
  });
}

test('a successful call is reserved, sent once with the credential, and settled at the receipt cost', async () => {
  await withRun(async (context) => {
    const answer = await request(context);
    assert.equal(answer.status, 200);
    assert.equal(context.gateway.chatBodies.length, 1);
    assert.equal(context.gateway.chatAuth[0], `Bearer ${KEY}`);
    const forwarded = JSON.parse(context.gateway.chatBodies[0] as string);
    assert.equal(forwarded.max_tokens, 8192);
    assert.equal(forwarded.stream, false);
    const state = context.ledger.state();
    assert.equal(state.callsAdmitted, 1);
    assert.equal(state.settledMicros, 100);
    assert.equal(state.committedMicros, 100);
    assert.equal(state.stopReason, undefined);
    assert.equal(context.relay.stopReason(), undefined);
  });
});

test('each admission makes exactly one upstream request, on a server error and on a timeout', async () => {
  await withRun(async (context) => {
    context.gateway.mode = { kind: 'status', status: 503 };
    const answer = await request(context);
    assert.equal(answer.status, 502);
    assert.equal(context.gateway.chatBodies.length, 1);
    assert.equal(context.relay.upstreamAttempts(), 1);
    assert.match(context.relay.stopReason() ?? '', /no usable receipt/);
    // The unknown call keeps its reservation, and the stopped run sends nothing more.
    assert.equal(context.ledger.state().unsettledIds.length, 1);
    const again = await request(context, 2);
    assert.equal(again.status, 403);
    assert.equal(context.gateway.chatBodies.length, 1);
  });
  await withRun(
    async (context) => {
      context.gateway.mode = { kind: 'hang' };
      const answer = await request(context);
      assert.equal(answer.status, 502);
      assert.equal(context.gateway.chatBodies.length, 1);
      assert.equal(context.relay.upstreamAttempts(), 1);
      assert.equal(context.ledger.state().unsettledIds.length, 1);
      assert.equal(context.ledger.state().stopReason !== undefined, true);
    },
    { upstreamTimeoutMs: 150 },
  );
});

test('a connection dropped by the gateway and a non-JSON answer are single attempts that keep the reservation', async () => {
  await withRun(async (context) => {
    context.gateway.mode = { kind: 'destroy' };
    const answer = await request(context);
    assert.equal(answer.status, 502);
    assert.equal(context.gateway.chatBodies.length, 1);
    assert.equal(context.ledger.state().unsettledIds.length, 1);
  });
  await withRun(async (context) => {
    context.gateway.mode = { kind: 'text', text: 'not json' };
    const answer = await request(context);
    assert.equal(answer.status, 502);
    assert.equal(context.gateway.chatBodies.length, 1);
    assert.equal(context.ledger.state().unsettledIds.length, 1);
  });
});

test('a rate-limit answer is not retried either', async () => {
  await withRun(async (context) => {
    context.gateway.mode = { kind: 'status', status: 429 };
    await request(context);
    assert.equal(context.gateway.chatBodies.length, 1);
  });
});

test('a receipt that breaks the pinned route or the output cap stops the run, with the cost settled', async () => {
  const cases: [string, TChatMode, RegExp][] = [
    ['provider', { kind: 'receipt', generation: { provider_name: 'route-b' } }, /provider differs/],
    [
      'generation model',
      { kind: 'receipt', generation: { model: 'other-model' } },
      /model differs/,
    ],
    ['model', { kind: 'receipt', patch: { model: 'other-model' } }, /model differs/],
    ['output', { kind: 'receipt', usage: { completion_tokens: 8193 } }, /exceed the output cap/],
    ['no output count', { kind: 'receipt', usage: { completion_tokens: 'many' } }, /output tokens/],
  ];
  for (const [name, mode, pattern] of cases) {
    await withRun(async (context) => {
      context.gateway.mode = mode;
      const answer = await request(context);
      assert.equal(answer.status, 502, name);
      assert.match(context.relay.stopReason() ?? '', pattern, name);
      assert.equal(context.ledger.state().settledMicros, 100, name);
      assert.equal(context.ledger.state().unsettledIds.length, 0, name);
      assert.equal((await request(context, 2)).status, 403, name);
      assert.equal(context.gateway.chatBodies.length, 1, name);
    });
  }
});

test('a receipt above its reservation is recorded against the ceiling and stops the run', async () => {
  await withRun(async (context) => {
    // The reservation for this call is a few cents; the receipt claims a dollar.
    context.gateway.mode = { kind: 'receipt', usage: { cost: 1 } };
    const answer = await request(context);
    assert.equal(answer.status, 502);
    assert.equal(context.ledger.state().committedMicros, 1_000_000);
    assert.match(context.relay.stopReason() ?? '', /exceeds the reservation/);
    assert.match(context.ledger.state().stopReason ?? '', /more than its reservation/);
  });
});

test('admission refuses past the cap or the ceiling and then nothing is sent', async () => {
  await withRun(
    async (context) => {
      assert.equal((await request(context, 1)).status, 200);
      const refused = await request(context, 2);
      assert.equal(refused.status, 403);
      assert.equal(context.relay.log.at(-1)?.code, 'admission');
      assert.equal(context.relay.log.at(-1)?.upstreamAttempts, 0);
      assert.equal(context.gateway.chatBodies.length, 1);
    },
    { header: { callCap: 1 } },
  );
  await withRun(
    async (context) => {
      const refused = await request(context, 1);
      assert.equal(refused.status, 403);
      assert.equal(context.gateway.chatBodies.length, 0);
      assert.equal(context.relay.upstreamAttempts(), 0);
    },
    { header: { ceilingMicros: 1_000 } },
  );
});

test('the reservation covers the bytes actually sent: a larger request reserves more', async () => {
  await withRun(async (context) => {
    await request(context, 1, 'x');
    const small = context.ledger.state().settledMicros;
    assert.equal(small, 100);
    const big = 'y'.repeat(50_000);
    const reservedBefore = context.ledger.state().callsAdmitted;
    await request(context, 2, big);
    assert.equal(context.ledger.state().callsAdmitted, reservedBefore + 1);
    assert.equal(context.gateway.chatBodies.length, 2);
    const sent = Buffer.byteLength(context.gateway.chatBodies[1] as string);
    assert.ok(sent > 50_000);
    // Reserved before the call: header basis applied to the sent bytes plus the allowance.
    const entry = readFileSync(context.ledgerPath, 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as { type: string; reservedMicros?: number; requestBytes?: number },
      )
      .filter((record) => record.type === 'reserve');
    assert.equal(entry[1]?.requestBytes, sent);
    assert.ok((entry[1]?.reservedMicros ?? 0) > (entry[0]?.reservedMicros ?? 0));
  });
});

test('the catalog, endpoint listing and credits checks read the gateway once each', async () => {
  const gateway = await startGateway();
  try {
    const location = { baseUrl: gateway.base, timeoutMs: 2_000 };
    assert.equal(await catalogListsModel(location, MODEL), true);
    assert.equal(await catalogListsModel(location, 'retired-model'), false);
    const listing = parseEndpointListing(await fetchEndpointListing(location, MODEL), PROVIDER);
    assert.deepEqual(listing.rates, {
      promptMicrosPerMillionTokens: 2_000_000,
      completionMicrosPerMillionTokens: 5_000_000,
    });
    assert.equal(basisCovers(header().basis, listing.rates), true);
    const credential = holdCredential(KEY);
    assert.deepEqual(await checkCredits(location, credential, 3_000_000), {
      remainingMicros: 3_500_000,
      sufficient: true,
    });
    assert.equal((await checkCredits(location, credential, 3_500_001)).sufficient, false);
    assert.equal(gateway.allPaths.filter((entry) => entry.includes('credits')).length, 2);
    // Credit rounds down and usage rounds up: the remaining amount is never overstated.
    // The balance is the remaining amount and rounds down: it is never overstated.
    gateway.credits = { balance: '3.4999999', total_used: '1.5', token_pass: null };
    assert.equal((await checkCredits(location, credential, 1)).remainingMicros, 3_499_999);
    gateway.credits = { balance: 0.25, total_used: '9', token_pass: null };
    assert.deepEqual(await checkCredits(location, credential, 250_001), {
      remainingMicros: 250_000,
      sufficient: false,
    });
    gateway.credits = { balance: 'lots' };
    await assert.rejects(checkCredits(location, credential, 1), /malformed/);
    gateway.credits = { data: { total_credits: 5, total_usage: 1.5 } };
    await assert.rejects(checkCredits(location, credential, 1), /malformed/);
    gateway.listing = { data: { endpoints: [] } };
    assert.throws(
      () => parseEndpointListing(gateway.listing as never, PROVIDER),
      /does not include/,
    );
    // The public checks send no credential.
    assert.equal(gateway.chatAuth.length, 0);
  } finally {
    await gateway.close();
  }
});

test('the client refuses a non-loopback plain HTTP address before connecting', async () => {
  const controller = new AbortController();
  await assert.rejects(
    requestOnce({
      url: 'http://gateway.invalid/v1/chat/completions',
      method: 'POST',
      body: '{}',
      credential: holdCredential(KEY),
      signal: controller.signal,
    }),
    /TLS/,
  );
  await assert.rejects(
    createGatewayUpstream({
      endpoint: 'http://127.0.0.1:9/v1/chat/completions',
      credential: holdCredential(KEY),
    })({
      url: 'http://127.0.0.1:9/v1/other',
      body: '{}',
      signal: controller.signal,
    }),
    /endpoint the upstream was not built for/,
  );
});

test('the credential appears nowhere in the ledger, the relay log or a failure message', async () => {
  await withRun(async (context) => {
    await request(context, 1);
    context.gateway.mode = { kind: 'destroy' };
    await request(context, 2);
    const evidence = JSON.stringify({ log: context.relay.log, state: context.ledger.state() });
    assert.equal(countLeaksInTexts(KEY, [evidence]), 0);
    const scan = countLeaksInPath(KEY, context.dir);
    assert.equal(scan.leaks, 0);
    assert.ok(scan.filesScanned >= 1);
    // The gateway did receive it, which is the one place it is meant to go.
    assert.equal(
      context.gateway.chatAuth.every((value) => value === `Bearer ${KEY}`),
      true,
    );
  });
});

test('a generation lookup waits for a lagging record, gives up within its bound, and refuses a bad id', async () => {
  const gateway = await startGateway();
  try {
    const location = { baseUrl: gateway.base, timeoutMs: 2_000 };
    const credential = holdCredential(KEY);
    gateway.generations.set('gen_abc123', { id: 'gen_abc123', provider_name: PROVIDER });
    gateway.lagPolls = 3;
    const lagging = fakeClock();
    const found = await lookupGeneration(location, credential, 'gen_abc123', lagging);
    assert.equal(found?.provider_name, PROVIDER);
    assert.equal(gateway.polls.length, 4);
    assert.equal(lagging.slept.length, 3);
    assert.ok(lagging.slept.every((ms) => ms <= 2_000));

    gateway.polls.length = 0;
    const never = fakeClock();
    assert.equal(await lookupGeneration(location, credential, 'gen_nothere', never), undefined);
    assert.ok(never.now() <= 30_000);
    assert.ok(never.slept.every((ms) => ms <= 2_000));
    assert.ok(gateway.polls.length > 3);
    assert.ok(gateway.polls.every((id) => id === 'gen_nothere'));

    gateway.polls.length = 0;
    for (const bad of ['', 'abc', 'gen_', 'gen_a/../b', 'gen_a b', 'gen_a?x=1']) {
      assert.equal(await lookupGeneration(location, credential, bad, fakeClock()), undefined);
    }
    assert.equal(gateway.polls.length, 0);
    assert.equal(gateway.chatBodies.length, 0);

    gateway.generationStatus = 401;
    const refused = lookupGeneration(location, credential, 'gen_abc123', fakeClock());
    await assert.rejects(refused, (error: Error) => {
      assert.match(error.message, /401/);
      assert.equal(error.message.includes(KEY), false);
      return true;
    });
  } finally {
    await gateway.close();
  }
});

test('a receipt without a generation record stops the run and keeps the reservation', async () => {
  await withRun(async (context) => {
    context.gateway.generationStatus = 404;
    const answer = await request(context);
    assert.equal(answer.status, 502);
    assert.match(context.relay.stopReason() ?? '', /no generation record confirming the provider/);
    assert.equal(context.ledger.state().settledMicros, 0);
    assert.equal(context.ledger.state().unsettledIds.length, 1);
    assert.equal((await request(context, 2)).status, 403);
    assert.equal(context.gateway.chatBodies.length, 1);
  });
});

test('a confirmed provider settles without a stop, at the larger of the two costs', async () => {
  await withRun(async (context) => {
    context.gateway.lagPolls = 2;
    context.gateway.mode = { kind: 'receipt', generation: { total_cost: 0.0003 } };
    assert.equal((await request(context)).status, 200);
    assert.equal(context.relay.stopReason(), undefined);
    assert.equal(context.ledger.state().settledMicros, 300);
    context.gateway.mode = {
      kind: 'receipt',
      usage: { cost: 0.0004 },
      generation: { total_cost: 0.0002 },
    };
    assert.equal((await request(context, 2)).status, 200);
    assert.equal(context.ledger.state().settledMicros, 700);
    assert.ok(context.relay.log.every((entry) => entry.accountingMs !== undefined));
    assert.equal(context.gateway.chatBodies.length, 2);
  });
});
