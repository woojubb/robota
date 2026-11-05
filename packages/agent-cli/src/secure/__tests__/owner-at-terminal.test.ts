import { createKeyring, fingerprint, getSealingPublicKey } from '@robota-sdk/agent-keyring';
import { describe, expect, it } from 'vitest';

import { openOwnerAtTerminal } from '../owner-at-terminal.js';
import {
  createMemoryKeyringStore,
  FIXTURE_PASSPHRASE,
  fixtureKeyring,
  scriptedSecureTerminal,
  withSwappedSealingKey,
} from './helpers.js';

describe('owner handover at the secret terminal', () => {
  it('opens and returns a disposable handover after a wrong credential', async () => {
    const { keyring } = await fixtureKeyring();
    const store = createMemoryKeyringStore(keyring);
    const terminal = scriptedSecureTerminal({ passphrase: ['wrong', FIXTURE_PASSPHRASE] });
    const handover = await openOwnerAtTerminal({ store, purpose: 'start a secure runtime', terminal: terminal.session });
    expect(handover?.fingerprint).toBe(fingerprint(getSealingPublicKey(keyring)));
    expect(terminal.prompts().filter((prompt) => prompt.startsWith('Passphrase:'))).toHaveLength(2);
    expect(terminal.everything()).toContain('That did not unlock the keyring.');
    expect(terminal.everything()).not.toContain(FIXTURE_PASSPHRASE);
    expect(store.saves).toHaveLength(0);
    handover?.dispose();
    expect(handover?.disposed).toBe(true);
  });

  it('accepts a recovery key on the same secret terminal', async () => {
    const { keyring, recoveryKey } = await fixtureKeyring();
    const terminal = scriptedSecureTerminal({ recoveryKey });
    const handover = await openOwnerAtTerminal({ store: createMemoryKeyringStore(keyring), purpose: 'attach', terminal: terminal.session, credential: 'recoveryKey' });
    expect(handover?.sealingKeyMatches).toBe(true);
    expect(terminal.everything()).not.toContain(recoveryKey);
    handover?.dispose();
  });

  it('cancels without a terminal, on empty input or on Ctrl-C, and gives up after three wrong tries', async () => {
    const { keyring } = await fixtureKeyring();
    const store = createMemoryKeyringStore(keyring);
    await expect(openOwnerAtTerminal({ store, purpose: 'attach', terminal: undefined })).resolves.toBeUndefined();
    const empty = scriptedSecureTerminal({ passphrase: '' });
    await expect(openOwnerAtTerminal({ store, purpose: 'attach', terminal: empty.session })).resolves.toBeUndefined();
    expect(empty.prompts()).toHaveLength(1);
    const cancelled = scriptedSecureTerminal({ cancelAt: /^Passphrase:/ });
    await expect(openOwnerAtTerminal({ store, purpose: 'attach', terminal: cancelled.session })).resolves.toBeUndefined();
    const cancelledAfterUnlock = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE, cancelAt: /^Press Enter/ });
    await expect(openOwnerAtTerminal({ store, purpose: 'attach', terminal: cancelledAfterUnlock.session })).resolves.toBeUndefined();
    const wrong = scriptedSecureTerminal({ passphrase: 'wrong' });
    await expect(openOwnerAtTerminal({ store, purpose: 'attach', terminal: wrong.session })).resolves.toBeUndefined();
    expect(wrong.prompts()).toHaveLength(3);
  });

  it('warns on a swapped sealing key without changing the keyring', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await createKeyring({ passphrase: 'another long passphrase' });
    other.unlocked.lock();
    const swapped = withSwappedSealingKey(keyring, other.keyring);
    const store = createMemoryKeyringStore(swapped);
    const terminal = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE });
    const handover = await openOwnerAtTerminal({ store, purpose: 'attach', terminal: terminal.session });
    expect(handover?.sealingKeyMatches).toBe(false);
    expect(terminal.everything()).toContain(fingerprint(getSealingPublicKey(swapped)));
    expect(terminal.everything()).toContain(fingerprint(getSealingPublicKey(keyring)));
    expect(terminal.everything()).toMatch(/changed|mismatch|different|differs/i);
    expect(store.saves).toHaveLength(0);
    handover?.dispose();
  });

  it('refuses a keyring replaced while the person was entering the credential', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await createKeyring({ passphrase: 'another long passphrase' });
    other.unlocked.lock();
    const store = createMemoryKeyringStore(keyring);
    const terminal = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE, meanwhile: { when: /^Passphrase:/, run: () => store.tamper(other.keyring) } });
    await expect(openOwnerAtTerminal({ store, purpose: 'attach', terminal: terminal.session })).rejects.toThrow(/changed/i);
  });
});
