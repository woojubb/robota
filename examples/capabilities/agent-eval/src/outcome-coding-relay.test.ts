import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TJson, TJsonObject } from './outcome-coding-protocol.js';
import {
  createCodingRelay,
  createScriptedUpstream,
  validateRelayRequest,
  type IRelayPolicy,
  type TUpstream,
} from './outcome-coding-relay.js';
import { BASELINE_SETTINGS, forcedRequestFields } from './outcome-coding-settings.js';

const ENDPOINT = 'https://relay.invalid/v1/chat/completions';
const MODEL = 'pinned-model';
const NOW = 1_000_000;

function policy(overrides: Partial<IRelayPolicy> = {}): IRelayPolicy {
  return {
    endpoint: ENDPOINT,
    model: MODEL,
    allowedTools: BASELINE_SETTINGS.allowedTools,
    forced: forcedRequestFields({ routing: { only: ['route-a'] } }),
    maxBodyBytes: 10_000,
    deadlineAt: NOW + 60_000,
    upstreamTimeoutMs: 1_000,
    ...overrides,
  };
}

function request(patch: TJsonObject = {}): { url: string; body: TJson } {
  return {
    url: ENDPOINT,
    body: {
      model: MODEL,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
      tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }],
      ...patch,
    },
  };
}

function refusalOf(patch: TJsonObject, overrides: Partial<IRelayPolicy> = {}, now = NOW): string {
  const decision = validateRelayRequest(policy(overrides), request(patch), now);
  assert.equal(decision.ok, false);
  return decision.ok ? '' : decision.code;
}

test('a request that matches the policy is accepted with the forced fields applied', () => {
  const decision = validateRelayRequest(policy(), request(), NOW);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.body.max_tokens, 8192);
  assert.equal(decision.body.temperature, 0.2);
  assert.equal(decision.body.stream, false);
  assert.deepEqual(decision.body.reasoning, { effort: 'high' });
  assert.deepEqual(decision.body.routing, { only: ['route-a'] });
  assert.deepEqual(JSON.parse(decision.encoded), decision.body);
});

test('a request that carries the forced values itself is accepted', () => {
  const carried = request({ max_tokens: 8192, temperature: 0.2, stream: false });
  assert.equal(validateRelayRequest(policy(), carried, NOW).ok, true);
});

test('the relay refuses anything outside the policy, each with its own reason', () => {
  assert.equal(
    validateRelayRequest(
      policy(),
      { ...request(), url: 'https://other.invalid/v1/chat/completions' },
      NOW,
    ).ok,
    false,
  );
  const wrongEndpoint = validateRelayRequest(
    policy(),
    { ...request(), url: `${ENDPOINT}?x=1` },
    NOW,
  );
  assert.equal(wrongEndpoint.ok ? '' : wrongEndpoint.code, 'endpoint');
  assert.equal(refusalOf({ model: 'another-model' }), 'model');
  assert.equal(refusalOf({ stream: true }), 'stream');
  assert.equal(
    refusalOf({
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
    }),
    'content',
  );
  assert.equal(
    refusalOf({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'input_audio' }] }],
    }),
    'content',
  );
  assert.equal(
    refusalOf({ tools: [{ type: 'function', function: { name: 'Bash', parameters: {} } }] }),
    'tool',
  );
  assert.equal(refusalOf({ tools: [{ type: 'web_search' }] }), 'tool-type');
  assert.equal(
    refusalOf({
      messages: [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: '1', type: 'function', function: { name: 'Bash', arguments: '{}' } }],
        },
      ],
    }),
    'tool',
  );
  assert.equal(refusalOf({ top_p: 0.5 }), 'field');
  assert.equal(refusalOf({ messages: [{ role: 'user', content: 'x', audio: {} }] }), 'field');
  assert.equal(refusalOf({ temperature: 1 }), 'setting');
  assert.equal(refusalOf({ max_tokens: 100_000 }), 'setting');
  assert.equal(refusalOf({ reasoning: { effort: 'low' } }), 'setting');
  assert.equal(refusalOf({ messages: [] }), 'malformed');
  assert.equal(refusalOf({ messages: [{ role: 'user', content: 'x'.repeat(20_000) }] }), 'size');
  assert.equal(refusalOf({}, {}, NOW + 60_000), 'deadline');
  assert.equal(
    refusalOf(
      {},
      { allowedTools: BASELINE_SETTINGS.allowedTools.filter((name) => name !== 'Read') },
    ),
    'tool',
  );
});

test('a body that is not an object is refused', () => {
  for (const body of [null, 'text', [1], 7] as TJson[]) {
    const decision = validateRelayRequest(policy(), { url: ENDPOINT, body }, NOW);
    assert.equal(decision.ok, false);
  }
});

function counting(answer: () => Promise<{ status: number; body: TJson }>): {
  upstream: TUpstream;
  calls: () => number;
} {
  let calls = 0;
  return {
    upstream: async () => {
      calls += 1;
      return answer();
    },
    calls: () => calls,
  };
}

test('each admitted request makes exactly one upstream attempt, on success, a server error, a throw and a timeout', async () => {
  const cases: {
    name: string;
    answer: () => Promise<{ status: number; body: TJson }>;
    status: number;
  }[] = [
    { name: 'success', answer: async () => ({ status: 200, body: { ok: true } }), status: 200 },
    {
      name: 'server error',
      answer: async () => ({ status: 503, body: { error: 'busy' } }),
      status: 503,
    },
    { name: 'throw', answer: async () => Promise.reject(new Error('reset')), status: 502 },
    { name: 'timeout', answer: () => new Promise(() => undefined), status: 502 },
  ];
  for (const scenario of cases) {
    const counted = counting(scenario.answer);
    const relay = createCodingRelay(policy({ upstreamTimeoutMs: 20 }), counted.upstream, () => NOW);
    const reply = await relay.handle({ id: 1, ...request() });
    assert.equal(reply.status, scenario.status, scenario.name);
    assert.equal(counted.calls(), 1, `${scenario.name} must not be retried`);
    assert.equal(relay.upstreamAttempts(), 1, scenario.name);
    assert.equal(relay.log[0]?.upstreamAttempts, 1, scenario.name);
  }
});

test('a refused request never reaches the upstream and gets a non-retryable answer', async () => {
  const counted = counting(async () => ({ status: 200, body: {} }));
  const relay = createCodingRelay(policy(), counted.upstream, () => NOW);
  const reply = await relay.handle({ id: 7, ...request({ model: 'other' }) });
  assert.equal(reply.id, 7);
  assert.equal(reply.status, 403);
  assert.equal(counted.calls(), 0);
  assert.equal(relay.upstreamAttempts(), 0);
  assert.deepEqual(
    relay.log.map((entry) => [entry.outcome, entry.code, entry.upstreamAttempts]),
    [['refused', 'model', 0]],
  );
});

test('the upstream receives the forwarded body with the forced fields, not the original', async () => {
  const seen: string[] = [];
  const relay = createCodingRelay(
    policy(),
    async ({ body, url }) => {
      seen.push(url, body);
      return { status: 200, body: {} };
    },
    () => NOW,
  );
  await relay.handle({ id: 1, ...request() });
  assert.equal(seen[0], ENDPOINT);
  const sent = JSON.parse(seen[1] ?? '{}') as Record<string, unknown>;
  assert.equal(sent.max_tokens, 8192);
  assert.deepEqual(sent.routing, { only: ['route-a'] });
});

test('the deadline closes the relay between requests', async () => {
  let now = NOW;
  const counted = counting(async () => ({ status: 200, body: {} }));
  const relay = createCodingRelay(policy(), counted.upstream, () => now);
  assert.equal((await relay.handle({ id: 1, ...request() })).status, 200);
  now = NOW + 60_001;
  assert.equal((await relay.handle({ id: 2, ...request() })).status, 403);
  assert.equal(counted.calls(), 1);
});

test('the scripted source answers in order and fails visibly past the end of its script', async () => {
  const scripted = createScriptedUpstream([
    { toolCalls: [{ name: 'Read', args: { filePath: '/x' } }] },
    { text: 'Done' },
  ]);
  const signal = new AbortController().signal;
  const call = { url: ENDPOINT, body: JSON.stringify({ model: MODEL }), signal };
  const first = await scripted(call);
  const second = await scripted(call);
  const third = await scripted(call);
  const firstChoice = (
    first.body as { choices: { message: Record<string, unknown>; finish_reason: string }[] }
  ).choices[0];
  assert.equal(firstChoice?.finish_reason, 'tool_calls');
  assert.equal(
    (firstChoice?.message.tool_calls as { function: { name: string } }[])[0]?.function.name,
    'Read',
  );
  const secondChoice = (second.body as { choices: { message: Record<string, unknown> }[] })
    .choices[0];
  assert.equal(secondChoice?.message.content, 'Done');
  assert.equal((first.body as { model: string }).model, MODEL);
  assert.equal(third.status, 500);
  assert.equal(scripted.calls(), 3);
});

test('a gate refusal sends nothing, and a stopping settlement ends the run without more attempts', async () => {
  let sent = 0;
  const upstream: TUpstream = async () => {
    sent += 1;
    return { status: 200, body: { ok: true } };
  };
  const decisions = [
    { ok: false as const, detail: 'ceiling: the reservation would exceed the ceiling' },
    {
      ok: true as const,
      settle: () => ({ stop: 'the receipt named another route' }),
    },
  ];
  const relay = createCodingRelay(policy(), upstream, () => NOW, {
    admit: () => decisions.shift() ?? { ok: false, detail: 'none left' },
  });
  const refused = await relay.handle({ id: 1, ...request() });
  assert.equal(refused.status, 403);
  assert.equal(sent, 0);
  assert.equal(relay.log[0]?.code, 'admission');
  assert.equal(relay.upstreamAttempts(), 0);

  const stopped = await relay.handle({ id: 2, ...request() });
  assert.equal(stopped.status, 502);
  assert.equal(sent, 1);
  assert.equal(relay.stopReason(), 'the receipt named another route');
  assert.equal(relay.log[1]?.outcome, 'stopped');

  const after = await relay.handle({ id: 3, ...request() });
  assert.equal(after.status, 403);
  assert.equal(relay.log[2]?.code, 'stopped');
  assert.equal(sent, 1);
  assert.equal(relay.upstreamAttempts(), 1);
});

test('a gate that throws while settling stops the run instead of losing the call', async () => {
  const relay = createCodingRelay(
    policy(),
    async () => ({ status: 200, body: {} }),
    () => NOW,
    {
      admit: () => ({
        ok: true,
        settle: () => {
          throw new Error('ledger write failed');
        },
      }),
    },
  );
  const answer = await relay.handle({ id: 1, ...request() });
  assert.equal(answer.status, 502);
  assert.match(relay.stopReason() ?? '', /ledger write failed/);
});

test('the relay awaits an asynchronous settlement and records its time apart from the upstream latency', async () => {
  let now = NOW;
  const upstream: TUpstream = async () => {
    now += 7;
    return { status: 200, body: { ok: true } };
  };
  const relay = createCodingRelay(policy(), upstream, () => now, {
    admit: () => ({
      ok: true,
      settle: async () => {
        now += 40;
        await Promise.resolve();
        return { stop: 'the record named another route' };
      },
    }),
  });
  assert.equal((await relay.handle({ id: 1, ...request() })).status, 502);
  assert.match(relay.stopReason() ?? '', /another route/);
  assert.equal(relay.log[0]?.outcome, 'stopped');
  assert.equal(relay.log[0]?.latencyMs, 7);
  assert.equal(relay.log[0]?.accountingMs, 40);
  assert.equal((await relay.handle({ id: 2, ...request() })).status, 403);

  const rejecting = createCodingRelay(policy(), upstream, () => now, {
    admit: () => ({ ok: true, settle: () => Promise.reject(new Error('lookup broke')) }),
  });
  assert.equal((await rejecting.handle({ id: 1, ...request() })).status, 502);
  assert.match(rejecting.stopReason() ?? '', /could not settle the call: lookup broke/);
});
