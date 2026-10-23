import type { JsonValue } from '../json-value';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationEnvelope,
  ConversationStore,
} from '../store-types';

export type ConversationStoreConformanceCase =
  | 'roundtrip'
  | 'shared-cas'
  | 'leases'
  | 'renew-release-race'
  | 'operation-retries'
  | 'lost-reply'
  | 'invalid-inputs';

export interface ConversationStoreConformanceFixture {
  /** Two clients backed by the same fresh, isolated namespace. They may be the same object. */
  readonly clients: readonly [ConversationStore, ConversationStore];
  readonly leaseMs: number;
  /** Establish authoritative backend time at or past this UTC Unix millisecond boundary. */
  advanceTo(unixMilliseconds: number): void | Promise<void>;
  cleanup(): void | Promise<void>;
}

export type CreateConversationStoreConformanceFixture = (
  name: ConversationStoreConformanceCase,
) => ConversationStoreConformanceFixture | Promise<ConversationStoreConformanceFixture>;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  // Envelopes have JSON data only; object property order is not part of the store contract.
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, ordered(item)]),
      );
    }
    return value;
  }
  check(JSON.stringify(ordered(actual)) === JSON.stringify(ordered(expected)), message);
}

async function rejects(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    check(
      error instanceof Error && 'code' in error && error.code === code,
      `expected ${code}, received ${String(error)}`,
    );
    return;
  }
  throw new Error(`expected ${code}, but operation succeeded`);
}

async function load(store: ConversationStore, id = 'room'): Promise<ConversationEnvelope> {
  const envelope = await store.load(id);
  check(envelope !== undefined, `missing envelope ${id}`);
  return envelope;
}

async function roundtrip({
  clients: [a, b],
  leaseMs,
}: ConversationStoreConformanceFixture): Promise<void> {
  equal(await a.load('missing'), undefined, 'missing load');
  equal(await b.lookupOperation('missing', 'missing'), undefined, 'missing operation');
  const input = { nested: { values: [null, true, 3, 'text'] }, unknownField: { future: 1 } };
  const expected = structuredClone(input);
  const created = await a.create('room', input);
  equal(
    created,
    { schemaVersion: 1, conversationId: 'room', revision: 0, state: expected },
    'complete initial envelope',
  );
  input.nested.values.push('mutation');
  created.state = null;
  equal(
    await load(b),
    { schemaVersion: 1, conversationId: 'room', revision: 0, state: expected },
    'create clone isolation',
  );
  const firstLoad = await load(a);
  check(
    firstLoad.state !== null &&
      typeof firstLoad.state === 'object' &&
      !Array.isArray(firstLoad.state),
    'loaded object state',
  );
  firstLoad.state.unknownField = 'mutation';
  equal((await load(b)).state, expected, 'load clone isolation');
  await rejects(() => b.create('room', null), 'conflict');
  const claim = await a.claim('room', 'owner', leaseMs);
  const state = { nested: ['kept'] };
  const change = { claim, expectedRevision: 0, operationId: 'one', state };
  const committed = await a.commit(change);
  state.nested.push('mutation');
  committed.state = null;
  const wanted = {
    schemaVersion: 1,
    conversationId: 'room',
    revision: 1,
    state: { nested: ['kept'] },
  };
  equal(await load(b), wanted, 'commit clone isolation');
  const receipt = await b.lookupOperation('room', 'one');
  check(receipt !== undefined, 'committed operation receipt missing');
  receipt.state = false;
  equal(await a.lookupOperation('room', 'one'), wanted, 'receipt clone isolation');
  for (const [i, value] of [null, true, 12, 'primitive', ['array']].entries()) {
    equal((await a.create(`primitive-${i}`, value)).state, value, 'opaque primitive JSON');
  }
}

async function sharedCas({
  clients: [a, b],
  leaseMs,
}: ConversationStoreConformanceFixture): Promise<void> {
  const creates = await Promise.allSettled([
    a.create('room', { created: 'a' }),
    b.create('room', { created: 'b' }),
  ]);
  check(
    creates.filter((result) => result.status === 'fulfilled').length === 1,
    'duplicate create must have one winner',
  );
  const rejected = creates.find((result) => result.status === 'rejected');
  check(
    rejected?.status === 'rejected' &&
      rejected.reason instanceof Error &&
      'code' in rejected.reason &&
      rejected.reason.code === 'conflict',
    'duplicate create must conflict',
  );
  const claim = await a.claim('room', 'owner', leaseMs);
  const changes = [
    { claim, expectedRevision: 0, operationId: 'a', state: { complete: ['a', 1] } },
    { claim, expectedRevision: 0, operationId: 'b', state: { complete: ['b', 2] } },
  ];
  const results = await Promise.allSettled([a.commit(changes[0]), b.commit(changes[1])]);
  check(
    results.filter((result) => result.status === 'fulfilled').length === 1,
    'shared CAS must have one winner',
  );
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      equal(await load(b), result.value, 'CAS winner is complete current envelope');
      equal(
        await a.lookupOperation('room', changes[i].operationId),
        result.value,
        'winner receipt',
      );
    } else {
      check(
        result.reason instanceof Error &&
          'code' in result.reason &&
          result.reason.code === 'conflict',
        'stale revision must conflict',
      );
      equal(
        await b.lookupOperation('room', changes[i].operationId),
        undefined,
        'CAS loser has no receipt',
      );
    }
  }
  equal(
    (await b.commit({ claim, expectedRevision: 1, operationId: 'next', state: null })).revision,
    2,
    'CAS loser cannot advance revision',
  );
}

async function staleOperations(
  a: ConversationStore,
  claim: ConversationClaim,
  revision: number,
): Promise<void> {
  await rejects(
    () =>
      a.commit({
        claim,
        expectedRevision: revision,
        operationId: `stale-${claim.fence}`,
        state: 'stale',
      }),
    'stale-claim',
  );
  await rejects(() => a.renew(claim, 100), 'stale-claim');
  await rejects(() => a.release(claim), 'stale-claim');
}

async function leases(f: ConversationStoreConformanceFixture): Promise<void> {
  const {
    clients: [a, b],
    leaseMs,
  } = f;
  await a.create('room', null);
  const first = await a.claim('room', 'owner', leaseMs);
  await rejects(() => b.claim('room', 'other', leaseMs), 'busy');
  await f.advanceTo(first.expiresAt - Math.max(1, Math.floor(leaseMs / 2)));
  const renewed = await b.renew(first, leaseMs);
  check(
    renewed.ownerId === first.ownerId &&
      renewed.fence === first.fence &&
      renewed.conversationId === first.conversationId,
    'renew preserves ownership',
  );
  check(renewed.expiresAt > first.expiresAt, 'renew extends authoritative expiry');
  await f.advanceTo(first.expiresAt);
  await rejects(() => a.claim('room', 'other', leaseMs), 'busy');
  // A caller's old expiresAt is metadata; the backend's renewed expiry governs ownership.
  await a.commit({ claim: first, expectedRevision: 0, operationId: 'renewed', state: null });
  await f.advanceTo(renewed.expiresAt);
  await rejects(() => a.renew(renewed, leaseMs), 'stale-claim');
  const successor = await b.claim('room', 'owner', leaseMs);
  check(successor.fence > first.fence, 'same-owner reacquisition increases fence');
  await staleOperations(a, first, 1);
  equal((await load(b)).revision, 1, 'stale owner cannot change state');
  await b.release(successor);
  await rejects(() => a.renew(successor, leaseMs), 'stale-claim');
  const other = await a.claim('room', 'other', leaseMs);
  check(
    other.fence > successor.fence && other.ownerId === 'other',
    'release transfers ownership with a new fence',
  );
  await staleOperations(b, successor, 1);
  equal(
    (await a.commit({ claim: other, expectedRevision: 1, operationId: 'successor', state: true }))
      .revision,
    2,
    'stale release cannot invalidate successor',
  );
}

async function renewReleaseRace({
  clients: [a, b],
  leaseMs,
}: ConversationStoreConformanceFixture): Promise<void> {
  await a.create('room', null);
  const claim = await a.claim('room', 'owner', leaseMs);
  const [renew, release] = await Promise.allSettled([a.renew(claim, leaseMs), b.release(claim)]);
  check(release.status === 'fulfilled', 'release must succeed against live same-fence renewal');
  if (renew.status === 'rejected') {
    check(
      renew.reason instanceof Error &&
        'code' in renew.reason &&
        renew.reason.code === 'stale-claim',
      'renew after release must refuse',
    );
  }
  const next = await b.claim('room', 'owner', leaseMs);
  check(next.fence > claim.fence, 'race must not revive released fence');
  await staleOperations(a, claim, 0);
  await b.commit({ claim: next, expectedRevision: 0, operationId: 'next', state: true });
}

async function operationRetries(f: ConversationStoreConformanceFixture): Promise<void> {
  const {
    clients: [a, b],
    leaseMs,
  } = f;
  await a.create('room', null);
  const claim = await a.claim('room', 'owner', leaseMs);
  const change: ConversationCommit = {
    claim,
    expectedRevision: 0,
    operationId: 'first',
    state: { a: 1, b: [true, null] },
  };
  const first = await a.commit(change);
  equal(
    await b.commit({ ...change, state: { b: [true, null], a: 1 } }),
    first,
    'canonical identical retry',
  );
  const latest = await b.commit({
    claim,
    expectedRevision: 1,
    operationId: 'later',
    state: 'latest',
  });
  equal(await a.commit(change), first, 'retry returns original receipt after later write');
  await rejects(() => b.commit({ ...change, state: 'changed' }), 'conflict');
  await rejects(() => b.commit({ ...change, expectedRevision: 1 }), 'conflict');
  await a.release(claim);
  equal(await b.commit(change), first, 'known retry precedes current claim validation');
  await f.advanceTo(claim.expiresAt);
  const next = await b.claim('room', 'replacement', leaseMs);
  equal(await a.commit(change), first, 'retry survives expiry and replacement');
  equal(await b.lookupOperation('room', 'first'), first, 'original lookup survives later writes');
  equal(await load(a), latest, 'retries and changed fingerprints cannot mutate current state');
  await a.create('second', null);
  const secondClaim = await a.claim('second', 'owner', leaseMs);
  equal(
    (
      await a.commit({
        claim: secondClaim,
        expectedRevision: 0,
        operationId: 'first',
        state: false,
      })
    ).conversationId,
    'second',
    'operation ids are conversation scoped',
  );
  await b.release(next);
}

async function lostReply({
  clients: [a, b],
  leaseMs,
}: ConversationStoreConformanceFixture): Promise<void> {
  await a.create('room', null);
  const claim = await a.claim('room', 'owner', leaseMs);
  const change = { claim, expectedRevision: 0, operationId: 'lost', state: { answer: 'once' } };
  const dropped = new Error('simulated reply loss after commit');
  try {
    await a.commit(change);
    throw dropped;
  } catch (error) {
    check(error === dropped, 'commit must succeed before reply is dropped');
  }
  const expected = { schemaVersion: 1, conversationId: 'room', revision: 1, state: change.state };
  equal(
    await b.lookupOperation('room', 'lost'),
    expected,
    'lost reply must be discoverable by operation id',
  );
  equal(await b.commit(change), expected, 'lost reply retry is idempotent');
  equal(await load(a), expected, 'lost reply retry cannot advance revision');
}

async function invalidInputs({
  clients: [a, b],
  leaseMs,
}: ConversationStoreConformanceFixture): Promise<void> {
  await rejects(() => a.create('', null), 'invalid-config');
  for (const value of [NaN, Infinity])
    await rejects(() => a.create('invalid', value), 'invalid-config');
  equal(await b.load('invalid'), undefined, 'invalid create cannot persist');
  await a.create('room', null);
  await rejects(() => a.claim('missing', 'owner', leaseMs), 'conflict');
  await rejects(() => a.claim('room', '', leaseMs), 'invalid-config');
  for (const lease of [0, -1, 0.5, Infinity])
    await rejects(() => a.claim('room', 'owner', lease), 'invalid-config');
  const claim = await a.claim('room', 'owner', leaseMs);
  const change = { claim, expectedRevision: 0, operationId: 'invalid', state: null };
  await rejects(() => b.commit({ ...change, expectedRevision: 1 }), 'conflict');
  await rejects(
    () => b.commit({ ...change, claim: { ...claim, ownerId: 'wrong' } }),
    'stale-claim',
  );
  await rejects(
    () => b.commit({ ...change, claim: { ...claim, fence: claim.fence + 1 } }),
    'stale-claim',
  );
  await rejects(() => b.commit({ ...change, operationId: '' }), 'invalid-config');
  await rejects(() => b.renew(claim, 0), 'invalid-config');
  for (const state of [NaN, Infinity])
    await rejects(() => b.commit({ ...change, state }), 'invalid-config');
  const cyclic: { self?: JsonValue } = {};
  cyclic.self = cyclic;
  await rejects(() => b.commit({ ...change, state: cyclic }), 'invalid-config');
  equal(
    await b.lookupOperation('room', 'invalid'),
    undefined,
    'rejected writes cannot create receipts',
  );
  equal(
    await load(a),
    { schemaVersion: 1, conversationId: 'room', revision: 0, state: null },
    'rejected writes cannot mutate envelope',
  );
  equal(
    (await a.commit({ ...change, operationId: 'valid' })).revision,
    1,
    'invalid requests cannot invalidate valid ownership',
  );
}

/** Runs each storage-contract scenario in a fresh fixture; throws with its case name on failure. */
export async function runConversationStoreConformance(
  createFixture: CreateConversationStoreConformanceFixture,
): Promise<void> {
  const cases: readonly [
    ConversationStoreConformanceCase,
    (fixture: ConversationStoreConformanceFixture) => Promise<void>,
  ][] = [
    ['roundtrip', roundtrip],
    ['shared-cas', sharedCas],
    ['leases', leases],
    ['renew-release-race', renewReleaseRace],
    ['operation-retries', operationRetries],
    ['lost-reply', lostReply],
    ['invalid-inputs', invalidInputs],
  ];
  for (const [name, run] of cases) {
    try {
      const fixture = await createFixture(name);
      try {
        check(
          Number.isSafeInteger(fixture.leaseMs) && fixture.leaseMs >= 2,
          'fixture leaseMs must be a safe integer of at least 2ms',
        );
        await run(fixture);
      } finally {
        await fixture.cleanup();
      }
    } catch (cause) {
      throw new Error(
        `ConversationStore conformance [${name}]: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }
}
