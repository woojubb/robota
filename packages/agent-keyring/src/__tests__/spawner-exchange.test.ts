/**
 * The spawner exchange: the spawner writes its ephemeral first, the runtime answers with its own and
 * its instance public key, and both sides derive the spawner key from the one shared secret. Pinned
 * from fixed ephemerals, and strict about every byte it reads.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { SpawnerKey, createRuntimeIdentity, startSpawnerExchange } from '../index.js';
import { createRuntimeIdentityWith, runtimeIdentitySecrets } from '../runtime-identity.js';
import { spawnerKeyBytes, startSpawnerExchangeWith } from '../spawner-exchange.js';
import {
  KAT_INSTANCE_PUBLIC_KEY_HEX,
  KAT_INSTANCE_SEED,
  codeOf,
  hex,
  reachableValues,
} from './helpers.js';
import {
  KAT_EXCHANGE,
  KAT_RUNTIME_EXCHANGE_SEED,
  KAT_SPAWNER_EPHEMERAL_SEED,
  fixedEntropy,
  refusalOf,
} from './link-helpers.js';

function katPair() {
  const spawner = startSpawnerExchangeWith(fixedEntropy([KAT_SPAWNER_EPHEMERAL_SEED]));
  const runtime = createRuntimeIdentityWith(
    fixedEntropy([KAT_INSTANCE_SEED, KAT_RUNTIME_EXCHANGE_SEED]),
  );
  return { spawner, runtime };
}

describe('the spawner exchange', () => {
  it('derives the pinned spawner key on both sides from fixed ephemerals', () => {
    const { spawner, runtime } = katPair();
    expect(hex(spawner.message)).toBe(KAT_EXCHANGE.spawnerEphemeral);
    const reply = runtime.answerSpawnerExchange(spawner.message);
    expect(hex(reply)).toBe(KAT_EXCHANGE.runtimeEphemeral + KAT_INSTANCE_PUBLIC_KEY_HEX);
    const result = spawner.complete(reply);
    expect(hex(result.instancePublicKey)).toBe(KAT_INSTANCE_PUBLIC_KEY_HEX);
    expect(hex(spawnerKeyBytes(result.spawnerKey))).toBe(KAT_EXCHANGE.spawnerKey);
    expect(hex(runtimeIdentitySecrets(runtime).spawnerKey() ?? Buffer.alloc(0))).toBe(
      KAT_EXCHANGE.spawnerKey,
    );
  });

  it('draws fresh ephemerals every time, so no two exchanges share a key', () => {
    const keys = new Set<string>();
    for (let index = 0; index < 4; index += 1) {
      const spawner = startSpawnerExchange();
      expect(spawner.message).toHaveLength(32);
      const runtime = createRuntimeIdentity();
      const { spawnerKey, instancePublicKey } = spawner.complete(
        runtime.answerSpawnerExchange(spawner.message),
      );
      expect(hex(instancePublicKey)).toBe(hex(runtime.instancePublicKey));
      keys.add(hex(spawnerKeyBytes(spawnerKey)));
    }
    expect(keys.size).toBe(4);
  });

  it('completes once, and only with a reply of exactly an ephemeral and an instance key', () => {
    const lowOrder = Buffer.concat([Buffer.alloc(32), Buffer.alloc(32, 1)]);
    for (const reply of [Buffer.alloc(63, 9), Buffer.alloc(65, 9), lowOrder, 'reply' as never]) {
      expect(refusalOf(() => startSpawnerExchange().complete(reply))).toBe('malformed');
    }
    const { spawner, runtime } = katPair();
    const reply = runtime.answerSpawnerExchange(spawner.message);
    spawner.complete(reply);
    expect(refusalOf(() => spawner.complete(reply))).toBe('out-of-order');
    const spent = startSpawnerExchange();
    expect(refusalOf(() => spent.complete(Buffer.alloc(10)))).toBe('malformed');
    expect(refusalOf(() => spent.complete(reply))).toBe('out-of-order');
  });

  it('is answered once by a runtime, and only for exactly an ephemeral', () => {
    for (const message of [
      Buffer.alloc(31, 9),
      Buffer.alloc(33, 9),
      Buffer.alloc(32),
      7 as never,
    ]) {
      expect(refusalOf(() => createRuntimeIdentity().answerSpawnerExchange(message))).toBe(
        'malformed',
      );
    }
    const runtime = createRuntimeIdentity();
    expect(runtime.spawnerKeyHeld).toBe(false);
    runtime.answerSpawnerExchange(startSpawnerExchange().message);
    expect(runtime.spawnerKeyHeld).toBe(true);
    expect(refusalOf(() => runtime.answerSpawnerExchange(startSpawnerExchange().message))).toBe(
      'out-of-order',
    );
    const refusedOnce = createRuntimeIdentity();
    expect(refusalOf(() => refusedOnce.answerSpawnerExchange(Buffer.alloc(3)))).toBe('malformed');
    expect(refusalOf(() => refusedOnce.answerSpawnerExchange(startSpawnerExchange().message))).toBe(
      'out-of-order',
    );
    expect(refusedOnce.spawnerKeyHeld).toBe(false);
  });
});

describe('a spawner key', () => {
  it('is opaque: nothing reachable from it is key bytes', () => {
    const { spawner, runtime } = katPair();
    const { spawnerKey } = spawner.complete(runtime.answerSpawnerExchange(spawner.message));
    expect(spawnerKey).toBeInstanceOf(SpawnerKey);
    expect(reachableValues(spawnerKey).some((value) => ArrayBuffer.isView(value))).toBe(false);
    expect(JSON.stringify(spawnerKey)).toBe('{}');
  });

  it('is zero-filled by wipe and refused afterwards; wipe is idempotent', () => {
    const { spawner, runtime } = katPair();
    const { spawnerKey } = spawner.complete(runtime.answerSpawnerExchange(spawner.message));
    const bytes = spawnerKeyBytes(spawnerKey);
    expect(spawnerKey.wiped).toBe(false);
    spawnerKey.wipe();
    expect(spawnerKey.wiped).toBe(true);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(codeOf(() => spawnerKeyBytes(spawnerKey))).toBe('keys-locked');
    spawnerKey.wipe();
    expect(spawnerKey.wiped).toBe(true);
  });
});
