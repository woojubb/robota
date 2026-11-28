import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TJson } from './outcome-coding-protocol.js';
import {
  createCodingRelay,
  createScriptedUpstream,
  type IRelayPolicy,
} from './outcome-coding-relay.js';
import { forcedRequestFields } from './outcome-coding-settings.js';
import {
  createRoleRegistry,
  delegationRoles,
  IMPLEMENTER_ROLE,
  PARENT_ROLE,
  REVIEWER_ROLE,
  roleByMarker,
  sha256Hex,
  systemMessageOf,
  unionTools,
} from './outcome-delegation-roles.js';

const ENDPOINT = 'https://relay.invalid/v1/chat/completions';
const MODEL = 'pinned-model';
const roles = delegationRoles('/work/project');

function body(system: string | null, tools: string[] = ['Read']): TJson {
  return {
    model: MODEL,
    messages: [
      ...(system === null ? [] : [{ role: 'system', content: system }]),
      { role: 'user', content: 'hello' },
    ],
    tools: tools.map((name) => ({ type: 'function', function: { name, parameters: {} } })),
  };
}

/** The system message the runtime would assemble for a role: its prompt plus framework text. */
function systemOf(name: string, suffix = ''): string {
  return `${roles.find((role) => role.name === name)?.systemPrompt ?? ''}${suffix}`;
}

function relayPolicy(overrides: Partial<IRelayPolicy> = {}): IRelayPolicy {
  return {
    endpoint: ENDPOINT,
    model: MODEL,
    allowedTools: [],
    forced: forcedRequestFields(),
    maxBodyBytes: 100_000,
    deadlineAt: Number.MAX_SAFE_INTEGER,
    upstreamTimeoutMs: 1_000,
    roles: createRoleRegistry(roles),
    ...overrides,
  };
}

test('the roles give the parent no write tool and the reviewer none either', () => {
  const tools = (name: string) => roles.find((role) => role.name === name)?.tools ?? [];
  assert.deepEqual(tools(PARENT_ROLE), ['Read', 'Glob', 'Grep', 'command_agent']);
  assert.deepEqual(tools(REVIEWER_ROLE), ['Read', 'Glob', 'Grep']);
  assert.ok(tools(IMPLEMENTER_ROLE).includes('Write'));
  for (const name of [PARENT_ROLE, REVIEWER_ROLE]) {
    assert.ok(!tools(name).includes('Write') && !tools(name).includes('Edit'));
  }
  assert.ok(unionTools(roles).includes('Write') && unionTools(roles).includes('command_agent'));
});

test('a role is bound to the hash of its system message at first sight, then recognized by the hash alone', () => {
  const registry = createRoleRegistry(roles);
  const first = registry.attribute(body(systemOf(IMPLEMENTER_ROLE, '\n\nframework text')));
  assert.equal(first.ok && first.role, IMPLEMENTER_ROLE);
  assert.equal(first.ok && first.hash, sha256Hex(systemOf(IMPLEMENTER_ROLE, '\n\nframework text')));
  const again = registry.attribute(body(systemOf(IMPLEMENTER_ROLE, '\n\nframework text')));
  assert.equal(again.ok && again.role, IMPLEMENTER_ROLE);
  assert.deepEqual(Object.keys(registry.bound()), [IMPLEMENTER_ROLE]);
});

test('a system message without a marker, with two markers, or changed for a bound role is unattributed', () => {
  const registry = createRoleRegistry(roles);
  assert.equal(registry.attribute(body('You are a helpful agent.')).ok, false);
  assert.equal(registry.attribute(body(null)).ok, false);
  assert.equal(
    registry.attribute(body(`${systemOf(PARENT_ROLE)}\n${systemOf(REVIEWER_ROLE)}`)).ok,
    false,
  );
  assert.equal(registry.attribute(body(systemOf(REVIEWER_ROLE))).ok, true);
  const changed = registry.attribute(body(systemOf(REVIEWER_ROLE, ' (edited)')));
  assert.equal(changed.ok, false);
  assert.match(changed.ok ? '' : changed.detail, /changed during the trial/);
});

test('the worker recognizes a role by its marker and reads one text system message', () => {
  assert.equal(roleByMarker(roles, body(systemOf(REVIEWER_ROLE)))?.name, REVIEWER_ROLE);
  assert.equal(roleByMarker(roles, body('no marker')), undefined);
  assert.equal(
    systemMessageOf({ messages: [{ role: 'system', content: [{ type: 'text', text: 'ab' }] }] }),
    'ab',
  );
  assert.equal(
    systemMessageOf({
      messages: [
        { role: 'system', content: 'a' },
        { role: 'system', content: 'b' },
      ],
    }),
    undefined,
  );
});

test('an unattributed call stops the run: it is refused, nothing is sent, and every later call is refused', async () => {
  const upstream = createScriptedUpstream([{ text: 'one' }, { text: 'two' }]);
  const relay = createCodingRelay(relayPolicy(), upstream);
  const good = await relay.handle({ id: 1, url: ENDPOINT, body: body(systemOf(PARENT_ROLE)) });
  assert.equal(good.status, 200);
  const stray = await relay.handle({ id: 2, url: ENDPOINT, body: body('stray system message') });
  assert.equal(stray.status, 403);
  assert.match(relay.stopReason() ?? '', /unattributed call/);
  const after = await relay.handle({ id: 3, url: ENDPOINT, body: body(systemOf(PARENT_ROLE)) });
  assert.equal(after.status, 403);
  assert.equal(upstream.calls(), 1);
  assert.deepEqual(
    relay.log.map((entry) => [entry.outcome, entry.code]),
    [
      ['forwarded', undefined],
      ['refused', 'unattributed'],
      ['refused', 'stopped'],
    ],
  );
});

test('each request is held to its own role: the parent cannot declare or call a write tool', async () => {
  const upstream = createScriptedUpstream([{ text: 'one' }, { text: 'two' }]);
  const relay = createCodingRelay(relayPolicy(), upstream);
  const parentDeclaresWrite = await relay.handle({
    id: 1,
    url: ENDPOINT,
    body: body(systemOf(PARENT_ROLE), ['Read', 'Write']),
  });
  assert.equal(parentDeclaresWrite.status, 403);
  const implementerDeclaresWrite = await relay.handle({
    id: 2,
    url: ENDPOINT,
    body: body(systemOf(IMPLEMENTER_ROLE), ['Read', 'Write']),
  });
  assert.equal(implementerDeclaresWrite.status, 200);
  const reviewerDeclaresWrite = await relay.handle({
    id: 3,
    url: ENDPOINT,
    body: body(systemOf(REVIEWER_ROLE), ['Write']),
  });
  assert.equal(reviewerDeclaresWrite.status, 403);
  assert.deepEqual(
    relay.log.map((entry) => [entry.role, entry.code ?? entry.outcome]),
    [
      [PARENT_ROLE, 'tool'],
      [IMPLEMENTER_ROLE, 'forwarded'],
      [REVIEWER_ROLE, 'tool'],
    ],
  );
  assert.equal(upstream.calls(), 1);
});

test('the call past the cap is refused for any arm, the cap is recorded, and nothing more is sent', async () => {
  for (const withRoles of [false, true]) {
    const upstream = createScriptedUpstream(Array.from({ length: 5 }, () => ({ text: 'x' })));
    const relay = createCodingRelay(
      relayPolicy({
        maxCalls: 2,
        allowedTools: ['Read'],
        ...(withRoles ? {} : { roles: undefined }),
      }),
      upstream,
    );
    const system = withRoles ? systemOf(IMPLEMENTER_ROLE) : 'single agent prompt';
    const statuses: number[] = [];
    for (let id = 1; id <= 4; id += 1) {
      statuses.push((await relay.handle({ id, url: ENDPOINT, body: body(system) })).status);
    }
    assert.deepEqual(statuses, [200, 200, 403, 403], `roles: ${withRoles}`);
    assert.equal(relay.capReached(), true);
    assert.equal(relay.upstreamAttempts(), 2);
    assert.equal(upstream.calls(), 2);
    assert.deepEqual(
      relay.log.filter((entry) => entry.outcome === 'refused').map((entry) => entry.code),
      ['cap', 'cap'],
    );
  }
});

test('a trial that stays under its cap is not marked as capped', async () => {
  const relay = createCodingRelay(
    relayPolicy({ maxCalls: 2, allowedTools: ['Read'], roles: undefined }),
    createScriptedUpstream([{ text: 'x' }, { text: 'y' }]),
  );
  await relay.handle({ id: 1, url: ENDPOINT, body: body('s') });
  await relay.handle({ id: 2, url: ENDPOINT, body: body('s') });
  assert.equal(relay.capReached(), false);
});

test('the relay log carries the role, the latency and the reported tokens of every attempt', async () => {
  let clock = 1_000;
  const relay = createCodingRelay(
    relayPolicy({ roles: undefined, allowedTools: ['Read'] }),
    async () => {
      clock += 40;
      return {
        status: 503,
        body: { error: 'busy', usage: { prompt_tokens: 7, completion_tokens: 3 } },
      };
    },
    () => clock,
  );
  await relay.handle({ id: 1, url: ENDPOINT, body: body('s') });
  const entry = relay.log[0];
  assert.equal(entry?.role, 'agent');
  assert.equal(entry?.latencyMs, 40);
  assert.equal(entry?.promptTokens, 7);
  assert.equal(entry?.completionTokens, 3);
  assert.equal(entry?.status, 503);
});
