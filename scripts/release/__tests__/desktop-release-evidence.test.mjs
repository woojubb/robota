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

test('the published-asset verifier accepts matching producer receipts and rejects clobbered bytes', async () => {
  const { createHash } = await import('node:crypto');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'robota-release-evidence-cli-'));
  try {
    const config = 'PRODUCT_ID=robota';
    const identity = {
      prefix: 'robota',
      tagPrefix: 'v',
      repository: 'https://github.com/owner/repo',
      configHash: createHash('sha256').update(config).digest('hex'),
    };
    const base = { tag: 'v3.0.3', sha: 'a'.repeat(40), attempt: 1, identity };
    const nativeNames = [
      'robota-darwin-arm64',
      'robota-darwin-x64',
      'robota-linux-arm64',
      'robota-linux-x64',
      'robota-windows-x64.exe',
      'SHA256SUMS.txt',
    ];
    const desktopNames = ['robota.dmg', 'robota.zip', 'SHA256SUMS-desktop-macos-latest.txt'];
    for (const name of [...nativeNames, ...desktopNames]) writeFileSync(join(dir, name), name);
    const native = makeEvidence({
      ...base,
      kind: 'native',
      run: 1,
      files: nativeNames.map((name) => join(dir, name)),
    });
    const desktop = makeEvidence({
      ...base,
      kind: 'desktop',
      run: 2,
      files: desktopNames.map((name) => join(dir, name)),
    });
    const nativePath = join(dir, 'native.json'),
      desktopPath = join(dir, 'desktop.json');
    writeFileSync(nativePath, JSON.stringify(native));
    writeFileSync(desktopPath, JSON.stringify(desktop));
    const env = {
      ...process.env,
      PRODUCT_BUILD_ENV: config,
      GH_REPO: 'owner/repo',
      RELEASE_TAG: base.tag,
      RELEASE_SHA: base.sha,
      NATIVE_RUN: '1',
      NATIVE_ATTEMPT: '1',
      DESKTOP_RUN: '2',
      DESKTOP_ATTEMPT: '1',
    };
    const verify = () =>
      spawnSync(
        process.execPath,
        ['scripts/release/verify-desktop-evidence.mjs', nativePath, desktopPath, dir],
        { env, encoding: 'utf8' },
      );
    assert.equal(verify().status, 0);
    writeFileSync(join(dir, 'robota.dmg'), 'changed');
    assert.notEqual(verify().status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
