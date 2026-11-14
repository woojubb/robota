/**
 * Known answer for sealed append-only lines: a prompt-history file whose lines two writer epochs
 * sealed, interleaved, as two TUI processes appending to one history would. Both writers were
 * `KeyHolderArtifactSealer`s over a holder that never unlocked, so they sealed to the key the file
 * holds: the sealing key of the fixed master key the keyring's own known-answer vectors use
 * (`fixtures/keyring-v1.json`). Sealing draws fresh randomness, so the file cannot be recomputed; it
 * was produced once from source and checked in. What it pins is that lines this build's product
 * wrote still open, each on its own, to the same text: a change to the line framing, the binding of a
 * line to its kind and owner, or the reuse of one sealed data key across an epoch fails here even
 * though every round trip still passes.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ArtifactCorruptError } from '@robota-sdk/agent-core';
import { getSealingPublicKey, parseKeyring } from '@robota-sdk/agent-keyring';
import { describe, expect, it } from 'vitest';

import { KeyHolderArtifactSealer } from '@robota-sdk/agent-local-host';
import { KeyHolder } from '@robota-sdk/agent-local-host';
import { createMemoryKeyringStore } from './helpers.js';

import type { IArtifactContext } from '@robota-sdk/agent-core';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** The sealing public key FIXED_MASTER_KEY derives, as the keyring's known answers pin it. */
const FIXED_MASTER_KEY_SEALING_PUBLIC_KEY =
  '4b73c35676631b6307fb28a3f70aaf47c331b86ada4996ce2f3c9f5c04cdba7a';
const FIXTURE_RECOVERY_KEY = 'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK';
const context: IArtifactContext = { kind: 'prompt-history-line', id: 'user' };

/** The file's lines in order: the writer epoch that sealed each, and exactly what it opens to. */
const KNOWN_LINES: ReadonlyArray<{ readonly epoch: 'A' | 'B'; readonly text: string }> = [
  {
    epoch: 'A',
    text: '{"at":"2026-11-01T00:01:00.000Z","sessionId":"session_kat_a","project":"/work/kat","text":"first prompt from writer A"}\n',
  },
  {
    epoch: 'B',
    text: '{"at":"2026-11-01T00:01:30.000Z","sessionId":"session_kat_b","project":"/work/kat","text":"first prompt from writer B"}\n',
  },
  {
    epoch: 'A',
    text: '{"at":"2026-11-01T00:02:00.000Z","sessionId":"session_kat_a","project":"/work/kat","text":"second prompt from writer A"}\n',
  },
  {
    epoch: 'A',
    text: '{"at":"2026-11-01T00:03:00.000Z","sessionId":"session_kat_a","project":"/work/kat","text":"a prompt over\\ntwo lines from writer A"}\n',
  },
  {
    epoch: 'B',
    text: '{"at":"2026-11-01T00:03:30.000Z","sessionId":"session_kat_b","project":"/work/kat","text":"second prompt from writer B, café"}\n',
  },
  {
    epoch: 'B',
    text: '{"at":"2026-11-01T00:04:00.000Z","sessionId":"session_kat_b","project":"/work/kat","text":"third prompt from writer B"}\n',
  },
];

const file = readFileSync(fixture('prompt-history-v1.sealed'), 'utf8');
const lines = file.split('\n').filter((line) => line.length > 0);
const keyring = parseKeyring(readFileSync(fixture('keyring-v1.json'), 'utf8'));

async function unlockedReader(): Promise<{ sealer: KeyHolderArtifactSealer; holder: KeyHolder }> {
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY });
  return { sealer: new KeyHolderArtifactSealer(holder), holder };
}

/** The sealed data key a line starts with: the 93 bytes every line of one writer epoch shares. */
function sealedKeyOf(line: string): string {
  return Buffer.from(line.slice('RSL1:'.length), 'base64url').subarray(0, 93).toString('hex');
}

describe('sealed prompt-history lines version 1 — known answer', () => {
  it('is one sealed line per append, sealed to the key of the fixed master key', () => {
    expect(Buffer.from(getSealingPublicKey(keyring)).toString('hex')).toBe(
      FIXED_MASTER_KEY_SEALING_PUBLIC_KEY,
    );
    expect(file.endsWith('\n')).toBe(true);
    expect(lines).toHaveLength(KNOWN_LINES.length);
    for (const line of lines) expect(line).toMatch(/^RSL1:[A-Za-z0-9_-]+$/);
  });

  it('opens every line to exactly the known text', async () => {
    const { sealer } = await unlockedReader();
    expect(lines.map((line) => sealer.openLine(line, context))).toEqual(
      KNOWN_LINES.map((known) => known.text),
    );
  });

  it('holds two interleaved writer epochs, each line naming its epoch by its sealed data key', () => {
    const epochs = new Map<string, Set<string>>();
    KNOWN_LINES.forEach((known, index) => {
      const keys = epochs.get(known.epoch) ?? new Set<string>();
      keys.add(sealedKeyOf(lines[index] as string));
      epochs.set(known.epoch, keys);
    });
    expect(epochs.get('A')?.size).toBe(1);
    expect(epochs.get('B')?.size).toBe(1);
    expect([...(epochs.get('A') ?? [])][0]).not.toBe([...(epochs.get('B') ?? [])][0]);
  });

  it('opens each line alone, with nothing learned from the others, in any order', async () => {
    for (const index of [5, 0, 3, 1, 4, 2]) {
      const { sealer } = await unlockedReader();
      expect(sealer.openLine(lines[index] as string, context)).toBe(KNOWN_LINES[index]?.text);
    }
  });

  it('is bound by exactly `robota/artifact/v1|prompt-history-line|user`', async () => {
    const { sealer, holder } = await unlockedReader();
    const blob = Buffer.from((lines[0] as string).slice('RSL1:'.length), 'base64url');
    expect(
      Buffer.from(
        holder.openBlob(blob, Buffer.from('robota/artifact/v1|prompt-history-line|user', 'utf8')),
      ).toString('utf8'),
    ).toBe(KNOWN_LINES[0]?.text);
    for (const other of [
      { kind: 'session-log-line', id: 'user' },
      { kind: 'prompt-history-line', id: 'user2' },
    ] as const) {
      expect(() => sealer.openLine(lines[0] as string, other)).toThrow(ArtifactCorruptError);
    }
  });
});
