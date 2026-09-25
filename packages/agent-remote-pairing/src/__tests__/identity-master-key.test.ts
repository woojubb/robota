import { describe, expect, it } from 'vitest';

import {
  MASTER_KEY_DERIVATION_PATH,
  deriveMasterKey,
  deriveSlip10Ed25519,
  ed25519KeyPairFromSeed,
  generateRecoveryPhrase,
  isRecoveryPhraseWord,
  recoveryPhraseFromEntropy,
  recoveryPhraseToSeed,
  validateRecoveryPhrase,
} from '../identity/master-key.js';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function unhex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

const HARDENED = 0x80000000;

/** The 24-word vectors of the official BIP39 test set (trezor/python-mnemonic vectors.json), passphrase "TREZOR". */
const BIP39_VECTORS: ReadonlyArray<readonly [string, string, string]> = [
  [
    '0000000000000000000000000000000000000000000000000000000000000000',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8',
  ],
  [
    '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
    'bc09fca1804f7e69da93c2f2028eb238c227f2e9dda30cd63699232578480a4021b146ad717fbb7e451ce9eb835f43620bf5c514db0f8add49f5d121449d3e87',
  ],
  [
    '8080808080808080808080808080808080808080808080808080808080808080',
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless',
    'c0c519bd0e91a2ed54357d9d1ebef6f5af218a153624cf4f2da911a0ed8f7a09e2ef61af0aca007096df430022f7a2b6fb91661a9589097069720d015e4e982f',
  ],
  [
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote',
    'dd48c104698c30cfe2b6142103248622fb7bb0ff692eebb00089b32d22484e1613912f0a5b694407be899ffd31ed3992c456cdf60f5d4564b8ba3f05a69890ad',
  ],
  [
    '68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c',
    'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length',
    '64c87cde7e12ecf6704ab95bb1408bef047c22db4cc7491c4271d170a1b213d20b385bc1588d9c7b38f1b39d415665b8a9030c9ec653d75e65f847d8fc1fc440',
  ],
  [
    '9f6a2878b2520799a44ef18bc7df394e7061a224d2c33cd015b157d746869863',
    'panda eyebrow bullet gorilla call smoke muffin taste mesh discover soft ostrich alcohol speed nation flash devote level hobby quick inner drive ghost inside',
    '72be8e052fc4919d2adf28d5306b5474b0069df35b02303de8c1729c9538dbb6fc2d731d5f832193cd9fb6aeecbc469594a70e3dd50811b5067f3b88b28c3e8d',
  ],
  [
    '066dca1a2bb7e8a1db2832148ce9933eea0f3ac9548d793112d9a95c9407efad',
    'all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform',
    '26e975ec644423f4a4c4f4215ef09b4bd7ef924e85d1d17c4cf3f136c2863cf6df0a475045652c57eb5fb41513ca2a2d67722b77e954b4b3fc11f7590449191d',
  ],
  [
    'f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f',
    'void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold',
    '01f5bced59dec48e362f2c45b5de68b9fd6c92c6634f44d6d40aab69056506f0e35524a518034ddc1192e1dacd32c1ed3eaa3c3b131c88ed8e7e54c49a5d0998',
  ],
];

interface ISlip10Step {
  readonly path: readonly number[];
  readonly chainCode: string;
  readonly privateKey: string;
  readonly publicKey: string;
}

/** SLIP-0010 "Test vector 1 for ed25519" and "Test vector 2 for ed25519", every chain. */
const SLIP10_VECTORS: ReadonlyArray<{ readonly seed: string; readonly steps: readonly ISlip10Step[] }> =
  [
    {
      seed: '000102030405060708090a0b0c0d0e0f',
      steps: [
        {
          path: [],
          chainCode: '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb',
          privateKey: '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
          publicKey: '00a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed',
        },
        {
          path: [0],
          chainCode: '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69',
          privateKey: '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
          publicKey: '008c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c',
        },
        {
          path: [0, 1],
          chainCode: 'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14',
          privateKey: 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2',
          publicKey: '001932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187',
        },
        {
          path: [0, 1, 2],
          chainCode: '2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c',
          privateKey: '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9',
          publicKey: '00ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1',
        },
        {
          path: [0, 1, 2, 2],
          chainCode: '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc',
          privateKey: '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662',
          publicKey: '008abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c',
        },
        {
          path: [0, 1, 2, 2, 1000000000],
          chainCode: '68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230',
          privateKey: '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
          publicKey: '003c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a',
        },
      ],
    },
    {
      seed: 'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
      steps: [
        {
          path: [],
          chainCode: 'ef70a74db9c3a5af931b5fe73ed8e1a53464133654fd55e7a66f8570b8e33c3b',
          privateKey: '171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012',
          publicKey: '008fe9693f8fa62a4305a140b9764c5ee01e455963744fe18204b4fb948249308a',
        },
        {
          path: [0],
          chainCode: '0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d',
          privateKey: '1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635',
          publicKey: '0086fab68dcb57aa196c77c5f264f215a112c22a912c10d123b0d03c3c28ef1037',
        },
        {
          path: [0, 2147483647],
          chainCode: '138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f',
          privateKey: 'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4',
          publicKey: '005ba3b9ac6e90e83effcd25ac4e58a1365a9e35a3d3ae5eb07b9e4d90bcf7506d',
        },
        {
          path: [0, 2147483647, 1],
          chainCode: '73bd9fff1cfbde33a1b846c27085f711c0fe2d66fd32e139d3ebc28e5a4a6b90',
          privateKey: '3757c7577170179c7868353ada796c839135b3d30554bbb74a4b1e4a5a58505c',
          publicKey: '002e66aa57069c86cc18249aecf5cb5a9cebbfd6fadeab056254763874a9352b45',
        },
        {
          path: [0, 2147483647, 1, 2147483646],
          chainCode: '0902fe8a29f9140480a00ef244bd183e8a13288e4412d8389d140aac1794825a',
          privateKey: '5837736c89570de861ebc173b1086da4f505d4adb387c6a1b1342d5e4ac9ec72',
          publicKey: '00e33c0f7d81d843c572275f287498e8d408654fdf0d1e065b84e2e6f157aab09b',
        },
        {
          path: [0, 2147483647, 1, 2147483646, 2],
          chainCode: '5d70af781f3a37b829f0d060924d5e960bdc02e85423494afc0b1a41bbe196d4',
          privateKey: '551d333177df541ad876a60ea71f00447931c0a9da16f227c11ea080d7391b8d',
          publicKey: '0047150c75db263559a70d5778bf36abbab30fb061ad69f69ece61a72b0cfa4fc0',
        },
      ],
    },
  ];

describe('recovery phrase (BIP39, 24 words)', () => {
  it.each(BIP39_VECTORS)('official vector %s: entropy → phrase → seed', async (entropy, phrase, seed) => {
    expect(recoveryPhraseFromEntropy(unhex(entropy))).toBe(phrase);
    expect(validateRecoveryPhrase(phrase)).toEqual({ ok: true });
    expect(hex(await recoveryPhraseToSeed(phrase, 'TREZOR'))).toBe(seed);
  });

  it('generates a valid, fresh 24-word phrase from 256 bits', () => {
    const a = generateRecoveryPhrase();
    const b = generateRecoveryPhrase();
    expect(a.split(' ')).toHaveLength(24);
    expect(validateRecoveryPhrase(a)).toEqual({ ok: true });
    expect(a).not.toBe(b);
  });

  it('refuses entropy that is not 256 bits', () => {
    expect(() => recoveryPhraseFromEntropy(new Uint8Array(16))).toThrow();
  });

  it('names why a phrase is invalid without echoing any word', () => {
    const phrase = BIP39_VECTORS[0][1];
    const twelve = phrase.split(' ').slice(0, 12).join(' ');
    expect(validateRecoveryPhrase(twelve)).toEqual({ ok: false, reason: 'word-count' });

    const unknown = phrase.replace(/art$/, 'zzzzqx');
    const verdict = validateRecoveryPhrase(unknown);
    expect(verdict).toEqual({ ok: false, reason: 'unknown-word' });
    expect(JSON.stringify(verdict)).not.toContain('zzzzqx');

    const badChecksum = phrase.replace(/art$/, 'zoo');
    expect(validateRecoveryPhrase(badChecksum)).toEqual({ ok: false, reason: 'checksum' });
    expect(validateRecoveryPhrase(42 as unknown as string)).toEqual({
      ok: false,
      reason: 'word-count',
    });
  });
});

describe('recovery phrase words', () => {
  it('accepts a word of the list in any case and refuses anything else', () => {
    expect(isRecoveryPhraseWord('abandon')).toBe(true);
    expect(isRecoveryPhraseWord(' Zoo ')).toBe(true);
    expect(isRecoveryPhraseWord('zzzzqx')).toBe(false);
    expect(isRecoveryPhraseWord('')).toBe(false);
    expect(isRecoveryPhraseWord('abandon art')).toBe(false);
  });
});

describe('SLIP-0010 ed25519 derivation', () => {
  for (const vector of SLIP10_VECTORS) {
    for (const step of vector.steps) {
      it(`seed ${vector.seed.slice(0, 8)}… m/${step.path.join("'/")}${step.path.length ? "'" : ''}`, async () => {
        const node = await deriveSlip10Ed25519(unhex(vector.seed), step.path);
        expect(hex(node.chainCode)).toBe(step.chainCode);
        expect(hex(node.privateKey)).toBe(step.privateKey);

        const { publicKeyRaw } = await ed25519KeyPairFromSeed(node.privateKey);
        expect(`00${hex(publicKeyRaw)}`).toBe(step.publicKey);
      });
    }
  }

  it('refuses an index that is already hardened or out of range', async () => {
    await expect(deriveSlip10Ed25519(unhex('00'.repeat(16)), [HARDENED])).rejects.toThrow();
    await expect(deriveSlip10Ed25519(unhex('00'.repeat(16)), [-1])).rejects.toThrow();
  });
});

describe('master key', () => {
  const phrase = BIP39_VECTORS[4][1];

  it('derives the same user from the same phrase, and a different one with a passphrase', async () => {
    const a = await deriveMasterKey(phrase);
    const b = await deriveMasterKey(`  ${phrase.toUpperCase().split(' ').join('   ')} `);
    const c = await deriveMasterKey(phrase, 'extra');
    expect(a.userId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.userId).toBe(a.userId);
    expect(b.publicKey).toBe(a.publicKey);
    expect(c.userId).not.toBe(a.userId);
  });

  it('is the Ed25519 key at the documented path', async () => {
    expect(MASTER_KEY_DERIVATION_PATH).toEqual([7240, 0]);
    const seed = await recoveryPhraseToSeed(phrase, '');
    const node = await deriveSlip10Ed25519(seed, MASTER_KEY_DERIVATION_PATH);
    const { publicKeyRaw } = await ed25519KeyPairFromSeed(node.privateKey);
    const master = await deriveMasterKey(phrase);
    const spki = Uint8Array.from(
      atob(master.publicKey.replace(/-/g, '+').replace(/_/g, '/')),
      (ch) => ch.charCodeAt(0),
    );
    expect(hex(spki.slice(-32))).toBe(hex(publicKeyRaw));
  });

  it('holds a non-extractable private key that signs and verifies', async () => {
    const master = await deriveMasterKey(phrase);
    expect(master.keyPair.privateKey.extractable).toBe(false);
    const data = new TextEncoder().encode('hello');
    const sig = await crypto.subtle.sign('Ed25519', master.keyPair.privateKey, data);
    expect(await crypto.subtle.verify('Ed25519', master.keyPair.publicKey, sig, data)).toBe(true);
  });

  it('refuses an invalid phrase without echoing it', async () => {
    const bad = phrase.replace(/length$/, 'zoo');
    await expect(deriveMasterKey(bad)).rejects.toThrow(/checksum/);
    await deriveMasterKey(bad).catch((error: unknown) => {
      expect(String(error)).not.toContain('hamster');
    });
  });
});
