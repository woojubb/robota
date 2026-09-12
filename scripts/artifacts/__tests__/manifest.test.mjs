import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { createManifest, validateManifest, verifyManifest } from '../manifest.mjs';

it('compares files against compiler records, rejecting an obsolete output', () => {
  const root = makeTemp('robota-artifact-manifest-');
  const manifest = createManifest([{ path: 'node/index.js', contents: 'export {};\n' }]);
  mkdirSync(path.join(root, 'node'));
  writeFileSync(path.join(root, 'node/index.js'), 'export {};\n');
  expect(() => verifyManifest(root, manifest)).not.toThrow();
  writeFileSync(path.join(root, 'node/removed.js'), 'obsolete');
  expect(() => verifyManifest(root, manifest)).toThrow(/unexpected.*node\/removed.js/);
});

it('checks native Windows writable state while retaining portable executable mode in the manifest', () => {
  const root = makeTemp('robota-artifact-windows-mode-');
  const file = path.join(root, 'bin.js');
  writeFileSync(file, 'code');
  chmodSync(file, 0o666);
  const manifest = createManifest([{ path: 'bin.js', contents: 'code', mode: 0o755 }]);
  expect(() => verifyManifest(root, manifest, { platform: 'win32' })).not.toThrow();
  expect(manifest.files[0].mode).toBe(0o755);
  chmodSync(file, 0o444);
  expect(() => verifyManifest(root, manifest, { platform: 'win32' })).toThrow(/mode mismatch/);
  chmodSync(file, 0o644);
});

it.each([
  '../escape',
  '/absolute',
  'node/../index.js',
  'node//index.js',
  'C:drive',
  'node\\index.js',
  'node/.',
  'node/index.js\0',
])('rejects unsafe manifest paths: %s', (unsafe) => {
  expect(() => createManifest([{ path: unsafe, contents: '' }])).toThrow(/path/);
});

it('validates persisted manifests and rejects duplicate or ambiguous file records', () => {
  const record = { path: 'index.js', contents: '' };
  expect(() => createManifest([record, record])).toThrow(/duplicate/);
  expect(() => createManifest([record, { ...record, path: 'INDEX.js' }])).toThrow(/duplicate/);
  for (const invalid of [
    null,
    {},
    { version: 2, files: [] },
    { version: 1, files: [{ path: 'a' }] },
  ]) {
    expect(() => validateManifest(invalid)).toThrow(/manifest/);
  }
});

it('rejects an internal symlink even when its bytes match an expected emission', () => {
  const root = makeTemp('robota-artifact-link-');
  const outside = makeTemp('robota-artifact-outside-');
  writeFileSync(path.join(outside, 'source.js'), 'export {};\n');
  symlinkSync(path.join(outside, 'source.js'), path.join(root, 'index.js'));
  const manifest = createManifest([{ path: 'index.js', contents: 'export {};\n', mode: 0o777 }]);
  expect(() => verifyManifest(root, manifest)).toThrow(/symlink/);
});

it('requires an already pinned physical root instead of walking a moving output link', () => {
  const root = makeTemp('robota-artifact-root-link-');
  const physical = path.join(root, 'physical');
  mkdirSync(physical);
  writeFileSync(path.join(physical, 'index.js'), 'code');
  const pointer = path.join(root, 'pointer');
  symlinkSync(physical, pointer, 'junction');
  expect(() =>
    verifyManifest(pointer, createManifest([{ path: 'index.js', contents: 'code' }])),
  ).toThrow(/physical directory/);
});
