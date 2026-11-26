/**
 * A process a debugger can read is not asked for a passphrase. A same-user SIGUSR1 sent before the
 * entry held the signal, or `--inspect` at launch, leaves an inspector open for the life of the
 * process, and a client of it reads what is typed and the keys an unlock opens, so the gate asks
 * nothing there: no prompt, no secret terminal, the keys stay locked and the person is told why.
 */
import { KeyHolder } from '@robota-sdk/agent-local-host';
import {
  FIXTURE_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
} from '@robota-sdk/agent-local-host/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { scriptedSecureTerminal } from '../../secure/__tests__/helpers.js';
import { INSPECTOR_OPEN_NOTICE, createProcessKeyCustody } from '../key-custody.js';

async function custodyWith(inspectorOpen: () => boolean) {
  const { keyring } = await fixtureKeyring();
  const store = createMemoryKeyringStore(keyring);
  const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
  const person = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE });
  const openTerminal = vi.fn(() => person.session);
  const custody = createProcessKeyCustody({
    holder,
    keyringStore: store,
    productRuntime: createTestProductRuntime(),
    openTerminal,
    inspectorOpen,
  });
  return { holder, custody, openTerminal, person };
}

describe('the unlock gate in a process with a debugger inspector open', () => {
  it('asks for no passphrase, opens no secret terminal and keeps the keys locked, saying why', async () => {
    const { holder, custody, openTerminal, person } = await custodyWith(() => true);

    const result = await custody.commands.unlock();

    expect(result).toEqual({ outcome: 'unavailable', notices: [INSPECTOR_OPEN_NOTICE] });
    expect(openTerminal).not.toHaveBeenCalled();
    expect(person.prompts()).toEqual([]);
    expect(holder.isUnlocked).toBe(false);
  });

  it('asks as usual in a process with none open', async () => {
    const { holder, custody, openTerminal, person } = await custodyWith(() => false);

    const result = await custody.commands.unlock();

    expect(result).toMatchObject({ outcome: 'unlocked' });
    expect(openTerminal).toHaveBeenCalledTimes(1);
    expect(person.prompts()).toEqual(['Passphrase: ']);
    expect(holder.isUnlocked).toBe(true);
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
