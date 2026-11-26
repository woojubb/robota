/**
 * The idle lock of a terminal that holds keys. The holder locks after its idle bound, and the bound
 * exists for a person who walked away, so it counts from the last key the terminal's input stream
 * carried: not output, not a timer, not the model, not the terminal's own focus reports. The stream
 * is watched only while the keys are open, and watching it never resumes a stream that was paused,
 * which the secret terminal needs to open. The person is told when the idle lock closes the keys,
 * which nothing they did announced. The clock is the test's own.
 */
import { PassThrough } from 'node:stream';

import { KeyHolder, type IKeyHolderTimer, type IKeyHolderTimers } from '@robota-sdk/agent-local-host';
import {
  FIXTURE_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
} from '@robota-sdk/agent-local-host/testing';
import { describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { scriptedSecureTerminal } from '../../secure/__tests__/helpers.js';
import { IDLE_LOCK_NOTICE, createProcessKeyCustody } from '../key-custody.js';

const MINUTE = 60_000;

/** A clock and timers the test advances by hand. */
function fakeTimers(): IKeyHolderTimers & { advance(ms: number): void } {
  let now = 1_000_000;
  const timers: Array<{ dueAt: number; cleared: boolean; fired: boolean; callback: () => void }> =
    [];
  return {
    now: () => now,
    setTimer(callback, delayMs): IKeyHolderTimer {
      const record = { dueAt: now + delayMs, cleared: false, fired: false, callback };
      timers.push(record);
      return {
        clear: () => {
          record.cleared = true;
        },
        unref: () => undefined,
      };
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cleared && !timer.fired && timer.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (due === undefined) break;
        now = due.dueAt;
        due.fired = true;
        due.callback();
      }
      now = target;
    },
  };
}

/** A custody over a holder with the test's clock and the test's terminal input, still locked. */
async function lockedCustody() {
  const timers = fakeTimers();
  const { keyring } = await fixtureKeyring();
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), timers });
  const person = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE });
  const input = new PassThrough();
  const custody = createProcessKeyCustody({
    holder,
    keyringStore: createMemoryKeyringStore(keyring),
    productRuntime: createTestProductRuntime(),
    openTerminal: () => person.session,
    input: () => input,
  });
  const said: string[] = [];
  custody.setChannel({ host: () => undefined, report: (message) => said.push(message) });
  const unlock = async (): Promise<void> => {
    await expect(custody.commands.unlock()).resolves.toMatchObject({ outcome: 'unlocked' });
    expect(holder.isUnlocked).toBe(true);
  };
  /** A key reaching the terminal's input; the test's stream is paused, so it is emitted, not written. */
  const type = (text: string): void => {
    input.emit('data', Buffer.from(text));
  };
  return { holder, timers, custody, said, input, unlock, type };
}

describe('the idle lock of a terminal that holds keys', () => {
  it('closes the keys at the idle bound when nothing was typed, and says so', async () => {
    const { holder, timers, said, unlock } = await lockedCustody();
    await unlock();

    timers.advance(14 * MINUTE);
    expect(holder.isUnlocked).toBe(true);
    expect(said).toEqual([]);
    timers.advance(2 * MINUTE);

    expect(holder.isUnlocked).toBe(false);
    expect(said).toEqual([IDLE_LOCK_NOTICE]);
  });

  it('counts from the last key typed, however often one is', async () => {
    const { holder, timers, said, unlock, type } = await lockedCustody();
    await unlock();

    for (let step = 0; step < 4; step += 1) {
      timers.advance(14 * MINUTE);
      expect(holder.isUnlocked).toBe(true);
      type('x');
    }
    timers.advance(14 * MINUTE);
    expect(holder.isUnlocked).toBe(true);
    timers.advance(2 * MINUTE);

    expect(holder.isUnlocked).toBe(false);
    expect(said).toEqual([IDLE_LOCK_NOTICE]);
  });

  it('does not count the terminal reporting that its window gained or lost focus', async () => {
    const { holder, timers, unlock, type } = await lockedCustody();
    await unlock();

    timers.advance(14 * MINUTE);
    type('\x1b[I');
    type('\x1b[O\x1b[I');
    timers.advance(2 * MINUTE);
    expect(holder.isUnlocked).toBe(false);

    await unlock();
    timers.advance(14 * MINUTE);
    // A key beside a focus report is still a key.
    type('\x1b[Ia');
    timers.advance(14 * MINUTE);
    expect(holder.isUnlocked).toBe(true);
  });

  it('watches the input only while the keys are open, once, and never resumes a paused stream', async () => {
    const { holder, input, unlock, custody } = await lockedCustody();
    input.pause();
    expect(input.listenerCount('data')).toBe(0);

    await unlock();
    expect(input.listenerCount('data')).toBe(1);
    expect(input.readableFlowing).toBe(false);

    custody.commands.lock();
    expect(holder.isUnlocked).toBe(false);
    expect(input.listenerCount('data')).toBe(0);

    await unlock();
    expect(input.listenerCount('data')).toBe(1);
  });

  it('stops watching when the idle lock closes the keys', async () => {
    const { timers, input, unlock } = await lockedCustody();
    await unlock();

    timers.advance(16 * MINUTE);

    expect(input.listenerCount('data')).toBe(0);
  });

  it('is not announced when the person locks, which `/lock` answers itself', async () => {
    const { holder, custody, said, unlock } = await lockedCustody();
    await unlock();

    custody.commands.lock();

    expect(holder.isUnlocked).toBe(false);
    expect(said).toEqual([]);
  });

  it('does not open the keys, or keep them open, because a key was typed while locked', async () => {
    const { holder, timers, unlock, type } = await lockedCustody();
    type('x');
    expect(holder.isUnlocked).toBe(false);

    await unlock();
    timers.advance(16 * MINUTE);
    expect(holder.isUnlocked).toBe(false);
  });
});
