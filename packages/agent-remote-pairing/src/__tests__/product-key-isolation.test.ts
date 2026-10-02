import { describe, expect, it } from 'vitest';

import { deriveMasterKey, recoveryPhraseFromEntropy } from '../identity/master-key.js';

const phrase = recoveryPhraseFromEntropy(new Uint8Array(32).fill(7));

describe('configured master key derivation', () => {
  it('preserves the existing Robota recovery identity at its public path', async () => {
    const phrase = recoveryPhraseFromEntropy(new Uint8Array(32));
    const master = await deriveMasterKey(phrase, { derivationPath: [7240, 0] });
    expect(master.publicKey).toBe('MCowBQYDK2VwAyEAimTK-OmGotZ4tsZvw25_RjXlGJ-TYkkG8r4JhgGolN8');
    expect(master.userId).toBe('w7hYdsfZoP3_oDwwW1Of6dnPKo6apZvAbi4zZDXLHEc');
  });
  it('isolates products and remains deterministic across interleaved calls', async () => {
    const a = { derivationPath: [100, 0] };
    const b = { derivationPath: [101, 0] };
    const [first, other] = await Promise.all([
      deriveMasterKey(phrase, a),
      deriveMasterKey(phrase, b),
    ]);
    const again = await deriveMasterKey(phrase, a);
    expect(first.userId).not.toBe(other.userId);
    expect(again.userId).toBe(first.userId);
    expect(first.keyPair.privateKey.extractable).toBe(false);
    expect(other.keyPair.privateKey.extractable).toBe(false);
  });

  it('requires a nonempty hardened derivation path', async () => {
    await expect(deriveMasterKey(phrase, { derivationPath: [] })).rejects.toThrow(/path/i);
    await expect(deriveMasterKey(phrase, { derivationPath: [-1] })).rejects.toThrow(/path/i);
    await expect(deriveMasterKey(phrase, { derivationPath: [2 ** 31] })).rejects.toThrow(/path/i);
  });

  it('snapshots the selected path before asynchronous seed derivation', async () => {
    const derivationPath = [100, 0];
    const pending = deriveMasterKey(phrase, { derivationPath });
    derivationPath[0] = 101;
    const expected = await deriveMasterKey(phrase, { derivationPath: [100, 0] });
    expect((await pending).userId).toBe(expected.userId);
  });
});
