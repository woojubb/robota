import { createHash } from 'node:crypto';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { create } from 'tar';
import { expect, test } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { createManifest } from '../manifest.mjs';
import { verifyPackedTarball } from '../pack-tar.mjs';

test('checks actual gzip tar entries against independently supplied content and mode records', async () => {
  const root = makeTemp('robota-pack-tar-');
  writeFileSync(path.join(root, 'index.js'), 'expected bytes');
  const tarballPath = path.join(root, 'archive.tgz');
  await create({ cwd: root, file: tarballPath, gzip: true, prefix: 'package', portable: true }, [
    'index.js',
  ]);
  const expected = createManifest([{ path: 'index.js', contents: 'expected bytes' }]);
  const result = await verifyPackedTarball(tarballPath, expected.files);
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.files).toEqual(expected.files);
  await expect(
    verifyPackedTarball(tarballPath, [
      { ...expected.files[0], sha256: createHash('sha256').update('other').digest('hex') },
    ]),
  ).rejects.toThrow(/content mismatch/);
  await expect(
    verifyPackedTarball(tarballPath, [{ ...expected.files[0], mode: 0o755 }]),
  ).rejects.toThrow(/mode mismatch/);
});

test('compares the complete pnpm JSON value despite asynchronous dependency key order, then binds raw bytes', async () => {
  const root = makeTemp('robota-pack-json-');
  const expectedPackageJson = {
    name: '@example/package',
    dependencies: { first: '1.0.0', second: '2.0.0' },
  };
  const actual = JSON.stringify(
    { name: '@example/package', dependencies: { second: '2.0.0', first: '1.0.0' } },
    null,
    2,
  );
  writeFileSync(path.join(root, 'package.json'), actual);
  const archive = path.join(root, 'archive.tgz');
  await create({ cwd: root, file: archive, gzip: true, prefix: 'package', portable: true }, [
    'package.json',
  ]);
  const expected = createManifest([
    { path: 'package.json', contents: JSON.stringify(expectedPackageJson, null, 2) },
  ]);
  const verified = await verifyPackedTarball(archive, expected.files, { expectedPackageJson });
  expect(verified.files[0].sha256).toBe(createHash('sha256').update(actual).digest('hex'));
  await expect(
    verifyPackedTarball(archive, expected.files, {
      expectedPackageJson: {
        ...expectedPackageJson,
        dependencies: { first: '9.0.0', second: '2.0.0' },
      },
    }),
  ).rejects.toThrow(/package.json/);
});

test.each(['export-order', 'duplicate-key', 'serialization'])(
  'rejects changed %s in package metadata',
  async (defect) => {
    const root = makeTemp('robota-pack-json-contract-');
    const expectedPackageJson = {
      name: '@example/package',
      exports: { import: './esm.js', default: './default.js' },
    };
    let actual = JSON.stringify(expectedPackageJson, null, 2);
    if (defect === 'export-order')
      actual = JSON.stringify(
        { name: '@example/package', exports: { default: './default.js', import: './esm.js' } },
        null,
        2,
      );
    if (defect === 'duplicate-key')
      actual = actual.replace('  "name":', '  "name": "@example/hidden",\n  "name":');
    if (defect === 'serialization') actual = JSON.stringify(expectedPackageJson);
    writeFileSync(path.join(root, 'package.json'), actual);
    const archive = path.join(root, 'archive.tgz');
    await create({ cwd: root, file: archive, gzip: true, prefix: 'package', portable: true }, [
      'package.json',
    ]);
    const expected = createManifest([
      { path: 'package.json', contents: JSON.stringify(expectedPackageJson, null, 2) },
    ]);
    await expect(
      verifyPackedTarball(archive, expected.files, { expectedPackageJson }),
    ).rejects.toThrow(/package.json/);
  },
);

test.each(['obsolete', 'duplicate', 'missing', 'symlink', 'truncated'])(
  'refuses a %s archive without extracting files',
  async (defect) => {
    const root = makeTemp('robota-pack-tar-refusal-');
    writeFileSync(path.join(root, 'index.js'), 'expected bytes');
    writeFileSync(path.join(root, 'obsolete.js'), 'old generation');
    const expected = createManifest([{ path: 'index.js', contents: 'expected bytes' }]);
    const tarballPath = path.join(root, 'archive.tgz');
    let entries = ['index.js'];
    if (defect === 'obsolete') entries.push('obsolete.js');
    if (defect === 'duplicate') entries.push('index.js');
    if (defect === 'missing')
      expected.files.push(...createManifest([{ path: 'missing.js', contents: 'required' }]).files);
    if (defect === 'symlink') {
      symlinkSync('index.js', path.join(root, 'link.js'));
      entries = ['link.js'];
      expected.files[0].path = 'link.js';
    }
    await create(
      { cwd: root, file: tarballPath, gzip: true, prefix: 'package', portable: true },
      entries,
    );
    if (defect === 'truncated')
      writeFileSync(tarballPath, readFileSync(tarballPath).subarray(0, 40));
    await expect(verifyPackedTarball(tarballPath, expected.files)).rejects.toThrow();
  },
);
