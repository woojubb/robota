import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeEvidence, assertEvidence } from '../desktop-release-evidence.mjs';

test('only the same tag, attempt, product and published bytes satisfy producer evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'robota-release-evidence-'));
  try {
    const file = join(dir, 'installer.dmg');
    writeFileSync(file, 'reviewed');
    const expected = {
      kind: 'desktop',
      tag: 'v3.0.3',
      sha: 'a'.repeat(40),
      run: 2,
      attempt: 1,
      identity: {
        prefix: 'robota',
        tagPrefix: 'v',
        repository: 'https://github.com/woojubb/robota',
        configHash: 'c'.repeat(64),
      },
      files: [file],
    };
    const evidence = makeEvidence(expected);
    assert.doesNotThrow(() => assertEvidence(expected, evidence, [file]));
    for (const changed of [
      { tag: 'v3.0.2' },
      { sha: 'b'.repeat(40) },
      { attempt: 2 },
      { identity: { ...expected.identity, prefix: 'other' } },
    ])
      assert.throws(() => assertEvidence({ ...expected, ...changed }, evidence, [file]));
    writeFileSync(file, 'modified');
    assert.throws(() => assertEvidence(expected, evidence, [file]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
