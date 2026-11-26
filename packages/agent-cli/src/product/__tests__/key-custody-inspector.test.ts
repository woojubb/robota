/**
 * A process a debugger can read is not asked for a passphrase. A same-user SIGUSR1 sent before the
 * entry held the signal, or `--inspect` at launch, leaves an inspector open for the life of the
 * process, and a client of it reads what is typed and the keys an unlock opens, so the gate asks
 * nothing there: no prompt, no secret terminal, the keys stay locked and the person is told why. The
 * question is checked again once the line is typed, because the first check was made before the
 * person took their time to type: an inspector open by then drops the line before the keyring is
 * tried with it.
 */
import { KeyHolder } from '@robota-sdk/agent-local-host';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
} from '@robota-sdk/agent-local-host/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { scriptedSecureTerminal } from '../../secure/__tests__/helpers.js';
import { INSPECTOR_OPEN_NOTICE, createProcessKeyCustody } from '../key-custody.js';

import type { IScriptedPerson } from '../../secure/__tests__/helpers.js';

/** A probe that answers each ask in turn from `answers`, and the last answer from then on. */
function probe(...answers: readonly boolean[]) {
  const inspectorOpen = vi.fn<() => boolean>(() => answers[answers.length - 1] ?? false);
  for (const answer of answers) inspectorOpen.mockReturnValueOnce(answer);
  return inspectorOpen;
}

async function custodyWith(
  inspectorOpen: () => boolean,
  person: IScriptedPerson = { passphrase: FIXTURE_PASSPHRASE },
) {
  const { keyring } = await fixtureKeyring();
  const store = createMemoryKeyringStore(keyring);
  const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
  const unlock = vi.spyOn(holder, 'unlock');
  const typist = scriptedSecureTerminal(person);
  const openTerminal = vi.fn(() => typist.session);
  const custody = createProcessKeyCustody({
    holder,
    keyringStore: store,
    productRuntime: createTestProductRuntime(),
    openTerminal,
    inspectorOpen,
  });
  return { holder, custody, openTerminal, person: typist, unlock };
}

describe('the unlock gate in a process with a debugger inspector open', () => {
  it('asks for no passphrase, opens no secret terminal and keeps the keys locked, saying why', async () => {
    const asked = probe(true);
    const { holder, custody, openTerminal, person, unlock } = await custodyWith(asked);

    const result = await custody.commands.unlock();

    expect(result).toEqual({ outcome: 'unavailable', notices: [INSPECTOR_OPEN_NOTICE] });
    expect(openTerminal).not.toHaveBeenCalled();
    expect(person.prompts()).toEqual([]);
    expect(unlock).not.toHaveBeenCalled();
    expect(holder.isUnlocked).toBe(false);
    // Refused at the first check, so there was no typing to check again.
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('asks as usual in a process with none open, checking before the prompt and again after the typing', async () => {
    const asked = probe(false, false);
    const { holder, custody, openTerminal, person, unlock } = await custodyWith(asked);

    const result = await custody.commands.unlock();

    expect(result).toMatchObject({ outcome: 'unlocked' });
    expect(openTerminal).toHaveBeenCalledTimes(1);
    expect(person.prompts()).toEqual(['Passphrase: ']);
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(holder.isUnlocked).toBe(true);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('asks each time, so an inspector opened after a refusal is found at the next unlock', async () => {
    let open = false;
    const { holder, custody } = await custodyWith(() => open);
    await expect(custody.commands.unlock()).resolves.toMatchObject({ outcome: 'unlocked' });
    custody.commands.lock();

    open = true;
    await expect(custody.commands.unlock()).resolves.toMatchObject({ outcome: 'unavailable' });
    expect(holder.isUnlocked).toBe(false);
  });
});

describe('the unlock gate when the inspector opens while the passphrase is being typed', () => {
  it('drops the typed line before the keyring is tried with it, and refuses as the first check does', async () => {
    const refusedAtFirstCheck = await (await custodyWith(probe(true))).custody.commands.unlock();
    const { holder, custody, openTerminal, person, unlock } = await custodyWith(probe(false, true));

    const result = await custody.commands.unlock();

    expect(result).toEqual(refusedAtFirstCheck);
    expect(result).toEqual({ outcome: 'unavailable', notices: [INSPECTOR_OPEN_NOTICE] });
    // The first check passed, so the person was asked; the second one stopped it before anything opened.
    expect(openTerminal).toHaveBeenCalledTimes(1);
    expect(person.prompts()).toEqual(['Passphrase: ']);
    expect(unlock).not.toHaveBeenCalled();
    expect(holder.isUnlocked).toBe(false);
    // Neither the answer nor what the terminal showed carries what was typed.
    expect(JSON.stringify(result)).not.toContain(FIXTURE_PASSPHRASE);
    expect(person.everything()).not.toContain(FIXTURE_PASSPHRASE);
  });

  it('leaves the gate usable: the next unlock in a process with none open asks again and opens', async () => {
    let asks = 0;
    const { holder, custody, unlock } = await custodyWith(() => {
      asks += 1;
      // The first unlock's second check (the second ask) finds an inspector; nothing is open for the next.
      return asks === 2;
    });

    await expect(custody.commands.unlock()).resolves.toMatchObject({ outcome: 'unavailable' });
    expect(unlock).not.toHaveBeenCalled();

    await expect(custody.commands.unlock()).resolves.toMatchObject({ outcome: 'unlocked' });
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(holder.isUnlocked).toBe(true);
  });

  it('checks after every line typed: a wrong passphrase is tried, and the retry is dropped when an inspector opened since', async () => {
    const asked = probe(false, false, true);
    const { holder, custody, person, unlock } = await custodyWith(asked, {
      passphrase: [OTHER_PASSPHRASE, FIXTURE_PASSPHRASE],
    });

    const result = await custody.commands.unlock();

    expect(result).toEqual({ outcome: 'unavailable', notices: [INSPECTOR_OPEN_NOTICE] });
    expect(person.prompts()).toEqual(['Passphrase: ', 'Passphrase: ']);
    // Only the first line, typed while nothing was open, was tried; the second never reached the keyring.
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(holder.isUnlocked).toBe(false);
    expect(asked).toHaveBeenCalledTimes(3);
  });
});
