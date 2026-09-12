import { expect, it } from 'vitest';
import { selectTransferPackages } from '../transfer-descriptor.mjs';
import { mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { createManifest } from '../manifest.mjs';
import { exportArtifacts, restoreArtifacts } from '../transfer.mjs';
import { Header } from 'tar';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { withArtifactLock } from '../writer-lock.mjs';

it('selects the exact build plan by name and artifact capability including private Vite', () => {
  const graph = {
    packages: [
      { name: '@fixture/core', directory: 'packages/core', artifact: { builder: 'tsdown' } },
      {
        name: '@fixture/web',
        directory: 'packages/web',
        artifact: { builder: 'vite' },
        private: true,
      },
      { name: '@fixture/app', directory: 'apps/app' },
    ],
  };
  const plan = {
    operation: 'build',
    mode: 'packages',
    packages: [{ name: '@fixture/web' }, { name: '@fixture/app' }],
  };
  expect(selectTransferPackages(plan, graph).map((item) => item.name)).toEqual(['@fixture/web']);
  expect(selectTransferPackages({ operation: 'build', mode: 'global' }, graph)).toHaveLength(2);
  expect(selectTransferPackages({ operation: 'build', mode: 'none' }, graph)).toEqual([]);
  expect(() => selectTransferPackages({ ...plan, packages: [{ name: 'missing' }] }, graph)).toThrow(
    /unknown/,
  );
  expect(() => selectTransferPackages({ ...plan, operation: 'test' }, graph)).toThrow(/build plan/);
});

function rawArchive(destination, entries) {
  const blocks = entries.flatMap((entry) => {
    const contents = Buffer.from(entry.contents ?? '');
    const header = new Header({
      path: entry.path,
      mode: 0o644,
      size: contents.length,
      type: entry.type ?? 'File',
      linkpath: entry.linkpath,
    });
    header.encode();
    return [header.block, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)];
  });
  writeFileSync(destination, gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])));
}

async function transferEntries(sourceRoot) {
  await publish(sourceRoot, 'core', 'core generation');
  await publish(sourceRoot, 'web', 'private web generation');
  const result = await exportArtifacts({
    root: sourceRoot,
    plan: { operation: 'build', mode: 'global' },
    archive: 'valid.tgz',
  });
  const descriptor = { version: 1, packages: result.packages };
  const entries = [{ path: 'package/transfer.json', contents: JSON.stringify(descriptor) }];
  descriptor.packages.forEach((item, index) => {
    entries.push({
      path: `package/entries/${index}/manifest.json`,
      contents: JSON.stringify(item.manifest),
    });
    const pinned = pinGeneration(path.join(sourceRoot, item.directory));
    for (const file of item.manifest.files)
      entries.push({
        path: `package/entries/${index}/dist/${file.path}`,
        contents: readFileSync(path.join(pinned.root, file.path)),
      });
  });
  return entries;
}

it('rejects corruption in the last package before publishing the first package', async () => {
  const sourceRoot = workspace();
  const destinationRoot = workspace();
  const previous = await publish(destinationRoot, 'core', 'previous core');
  const entries = await transferEntries(sourceRoot);
  const archive = path.join(sourceRoot, 'corrupt.tgz');
  rawArchive(
    archive,
    entries.map((entry, index) =>
      index === entries.length - 1 ? { ...entry, contents: 'modified payload' } : entry,
    ),
  );
  await expect(restoreArtifacts({ root: destinationRoot, archive })).rejects.toThrow(
    /content mismatch/,
  );
  expect(pinGeneration(path.join(destinationRoot, 'packages/core')).id).toBe(previous.id);
});

it('rejects symlinks, duplicate entries, traversal, missing files and metadata path substitution', async () => {
  const sourceRoot = workspace();
  const destinationRoot = workspace();
  const entries = await transferEntries(sourceRoot);
  const archive = path.join(sourceRoot, 'hostile.tgz');
  const descriptor = JSON.parse(entries[0].contents);
  descriptor.packages[0].directory = 'packages/web';
  const candidates = [
    [
      ...entries.slice(0, -1),
      { ...entries.at(-1), contents: '', type: 'SymbolicLink', linkpath: '/outside' },
    ],
    [...entries, entries.at(-1)],
    [...entries, { path: 'package/../../outside', contents: 'escape' }],
    entries.slice(0, -1),
    [{ ...entries[0], contents: JSON.stringify(descriptor) }, ...entries.slice(1)],
  ];
  for (const candidate of candidates) {
    rawArchive(archive, candidate);
    await expect(restoreArtifacts({ root: destinationRoot, archive })).rejects.toThrow(
      /transfer:|pack:/,
    );
  }
  expect(() => lstatSync(path.join(destinationRoot, 'packages/core/dist'))).toThrow();
});

it('uses the specified CLI plan and exits nonzero for an invalid archive', async () => {
  const sourceRoot = workspace();
  const destinationRoot = workspace();
  await publish(sourceRoot, 'web', 'only selected web generation');
  writeFileSync(
    path.join(sourceRoot, 'plan.json'),
    JSON.stringify({ operation: 'build', mode: 'packages', packages: [{ name: '@fixture/web' }] }),
  );
  const driver = path.resolve(import.meta.dirname, '../transfer.mjs');
  const exported = spawnSync(
    process.execPath,
    [driver, 'export', '--plan', 'plan.json', '--archive', 'output.tgz'],
    { cwd: sourceRoot, encoding: 'utf8', timeout: 15000 },
  );
  expect(exported.status, exported.stderr).toBe(0);
  const restored = spawnSync(
    process.execPath,
    [driver, 'restore', '--archive', path.join(sourceRoot, 'output.tgz')],
    { cwd: destinationRoot, encoding: 'utf8', timeout: 15000 },
  );
  expect(restored.status, restored.stderr).toBe(0);
  expect(pinGeneration(path.join(destinationRoot, 'packages/web')).manifest.files).toHaveLength(1);
  const failed = spawnSync(process.execPath, [driver, 'restore', '--archive', 'missing.tgz'], {
    cwd: destinationRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('artifact transfer failed:');
});

it('reports already restored packages if a later package writer lock refuses publication', async () => {
  const sourceRoot = workspace();
  const destinationRoot = workspace();
  await transferEntries(sourceRoot);
  await withArtifactLock(path.join(destinationRoot, 'packages/web'), async () => {
    await expect(
      restoreArtifacts({ root: destinationRoot, archive: path.join(sourceRoot, 'valid.tgz') }),
    ).rejects.toThrow(/restore failed for @fixture\/web; completed=.*@fixture\/core/);
  });
});

it('refuses physical dist fallback and never overwrites an existing archive', async () => {
  const root = workspace();
  const plan = { operation: 'build', mode: 'packages', packages: [{ name: '@fixture/core' }] };
  mkdirSync(path.join(root, 'packages/core/dist'));
  writeFileSync(path.join(root, 'packages/core/dist/index.js'), 'unverified physical output');
  await expect(exportArtifacts({ root, plan, archive: 'output.tgz' })).rejects.toThrow();
  const other = workspace();
  await publish(other, 'core', 'valid generation');
  writeFileSync(path.join(other, 'output.tgz'), 'preserve existing archive');
  await expect(exportArtifacts({ root: other, plan, archive: 'output.tgz' })).rejects.toThrow(
    /EEXIST/,
  );
  expect(readFileSync(path.join(other, 'output.tgz'), 'utf8')).toBe('preserve existing archive');
});

function workspace() {
  const root = makeTemp('robota-transfer-');
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  for (const [name, builder] of [
    ['core', 'tsdown'],
    ['web', 'vite'],
  ]) {
    const directory = path.join(root, 'packages', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: `@fixture/${name}`,
        private: name === 'web',
        scripts: { build: 'unused' },
        robota: { artifact: { builder } },
      }),
    );
  }
  return root;
}

async function publish(root, name, contents) {
  return assembleGeneration(path.join(root, 'packages', name), async ({ outputRoot }) => {
    writeFileSync(path.join(outputRoot, 'index.js'), contents);
    return createManifest([{ path: 'index.js', contents }]);
  });
}

it('transfers verified physical generations between two roots and permits a subsequent rebuild', async () => {
  const sourceRoot = workspace();
  const destinationRoot = workspace();
  const core = await publish(sourceRoot, 'core', 'core generation');
  const web = await publish(sourceRoot, 'web', 'private web generation');
  const archive = path.join(sourceRoot, 'package-dist.tgz');
  const plan = {
    operation: 'build',
    mode: 'packages',
    packages: [{ name: '@fixture/core' }, { name: '@fixture/web' }],
  };
  const exported = await exportArtifacts({ root: sourceRoot, plan, archive });
  expect(exported.packages).toHaveLength(2);
  const restored = await restoreArtifacts({ root: destinationRoot, archive });
  expect(restored.packages.map((item) => item.sourceId)).toEqual([core.id, web.id]);
  for (const name of ['core', 'web']) {
    expect(lstatSync(path.join(destinationRoot, 'packages', name, 'dist')).isSymbolicLink()).toBe(
      true,
    );
    const pinned = pinGeneration(path.join(destinationRoot, 'packages', name));
    expect(readFileSync(path.join(pinned.root, 'index.js'), 'utf8')).toContain('generation');
  }
  const next = await publish(destinationRoot, 'core', 'subsequent affected rebuild');
  expect(pinGeneration(path.join(destinationRoot, 'packages/core')).id).toBe(next.id);
});
