/**
 * The authorship side of the port as the product sealers offer it. Only the sealer
 * over the key holder can tag, since only it reaches unlocked keys; the write-only and process-local
 * sealers hold no secret and offer neither tags nor unlock notices. A store subscribes to unlocks to
 * tag what it wrote while locked, and the sealer holds that subscription weakly, so a store nothing
 * else refers to is still collected.
 */
import { Buffer } from 'node:buffer';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { isArtifactLockedError } from '@robota-sdk/agent-core';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { describe, expect, it } from 'vitest';

import {
  KeyHolderArtifactSealer,
  ProcessLocalArtifactSealer,
  WriteOnlyArtifactSealer,
} from '../artifact-sealer.js';
import { KeyHolder } from '../key-holder.js';
import { FIXTURE_PASSPHRASE, createMemoryKeyringStore, fixtureKeyring } from './helpers.js';

setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

const context = { kind: 'session-record', id: 'sess_tagged' } as const;
const envelope = Buffer.from('{"schemaVersion":1}');
const passphrase = { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE } as const;

async function holderAndSealer(): Promise<{ holder: KeyHolder; sealer: KeyHolderArtifactSealer }> {
  const holder = new KeyHolder({
    store: createMemoryKeyringStore((await fixtureKeyring()).keyring),
    policy: { idleMs: 0 },
  });
  return { holder, sealer: new KeyHolderArtifactSealer(holder) };
}

/** Whether what `reference` points to is collected once nothing else holds it. */
async function isCollected(reference: WeakRef<object>): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
    if (reference.deref() === undefined) return true;
  }
  return false;
}

describe('KeyHolderArtifactSealer authorship tags', () => {
  it('tag and verify through the holder while unlocked, and say locked otherwise', async () => {
    const { holder, sealer } = await holderAndSealer();
    await holder.unlock(passphrase);
    const tag = sealer.tagAuthorship(envelope, context);

    expect(sealer.verifyAuthorship(envelope, tag, context)).toBe(true);
    expect(sealer.verifyAuthorship(envelope, tag, { ...context, id: 'sess_other' })).toBe(false);
    holder.lock('explicit');
    for (const call of [
      () => sealer.tagAuthorship(envelope, context),
      () => sealer.verifyAuthorship(envelope, tag, context),
    ]) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(isArtifactLockedError(thrown)).toBe(true);
    }
  });

  it('are not offered by a sealer that holds no secret', async () => {
    const { sealer } = await holderAndSealer();
    for (const keyless of [
      new WriteOnlyArtifactSealer(sealer.writeGrant()),
      new ProcessLocalArtifactSealer(),
    ]) {
      expect('tagAuthorship' in keyless).toBe(false);
      expect('verifyAuthorship' in keyless).toBe(false);
      expect('onUnlock' in keyless).toBe(false);
    }
  });
});

describe('KeyHolderArtifactSealer unlock listeners', () => {
  it('hear each unlock of the holder until they unsubscribe or the sealer is disposed', async () => {
    const { holder, sealer } = await holderAndSealer();
    let first = 0;
    let second = 0;
    const listenFirst = (): void => {
      first += 1;
    };
    const listenSecond = (): void => {
      second += 1;
    };
    const stopFirst = sealer.onUnlock(listenFirst);
    sealer.onUnlock(listenSecond);

    await holder.unlock(passphrase);
    stopFirst();
    holder.lock('explicit');
    await holder.unlock(passphrase);
    sealer.dispose();
    holder.lock('explicit');
    await holder.unlock(passphrase);

    expect([first, second]).toEqual([1, 2]);
  });

  it('hold a listener weakly, so the subscriber is collected while the sealer lives', async () => {
    const { sealer } = await holderAndSealer();
    const reference = ((): WeakRef<object> => {
      const listener = (): void => {};
      sealer.onUnlock(listener);
      return new WeakRef(listener);
    })();

    expect(await isCollected(reference)).toBe(true);
  });

  it('do not keep alive a sealing store that nothing else refers to', async () => {
    const { sealer } = await holderAndSealer();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sealer-authorship-')));
    const reference = ((): WeakRef<object> => {
      const store = new NodeSessionStore(dir, { sealing: { sealer } });
      return new WeakRef(store);
    })();

    expect(await isCollected(reference)).toBe(true);
    expect(sealer.writeGrant()).toMatch(/^rsg1\./);
  });
});
