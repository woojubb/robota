import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { createManifest } from '../manifest.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { recoverGeneration } from '../recovery.mjs';

function emitter(contents) {
  return async ({ outputRoot }) => {
    mkdirSync(path.join(outputRoot, 'node'));
    writeFileSync(path.join(outputRoot, 'node/index.js'), contents);
    return createManifest([{ path: 'node/index.js', contents }]);
  };
}

it('publishes a complete generation while a pinned reader retains the previous one', async () => {
  const root = realpathSync(makeTemp('robota-generation-'));
  const first = await assembleGeneration(root, emitter('first'));
  const second = await assembleGeneration(root, emitter('second'));
  expect(first.id).not.toBe(second.id);
  expect(readFileSync(path.join(first.root, 'node/index.js'), 'utf8')).toBe('first');
  expect(readFileSync(path.join(root, 'dist/node/index.js'), 'utf8')).toBe('second');
  expect(pinGeneration(root)).toEqual(second);
});

it('publishes a separately declared output variant without changing the default generation', async () => {
  const root = realpathSync(makeTemp('robota-generation-variant-'));
  const node = await assembleGeneration(root, emitter('node'));
  const binary = await assembleGeneration(root, emitter('binary'), { outputName: 'dist-bun' });
  expect(pinGeneration(root)).toEqual(node);
  expect(pinGeneration(root, { outputName: 'dist-bun' })).toEqual(binary);
  await expect(
    assembleGeneration(root, emitter('unsafe'), { outputName: '../foreign' }),
  ).rejects.toThrow(/output name/);
});

it.each([
  { stop: 'previous-dist', action: 'restored-previous', installed: false },
  { stop: 'dist', action: 'finalized-publication', installed: true },
  { stop: 'stage', action: 'released-interrupted-stage', installed: false },
  { stop: 'before-backup', action: 'kept-previous', installed: false },
])('recovers an actual process exit at $stop', ({ stop, action, installed }) => {
  const root = realpathSync(makeTemp('robota-generation-interrupt-'));
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/legacy.txt'), 'uninterrupted bytes');
  const moduleUrl = new URL('../generation.mjs', import.meta.url).href;
  const manifestUrl = new URL('../manifest.mjs', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import { writeFileSync, renameSync } from 'node:fs';
    import path from 'node:path';
    import { assembleGeneration } from ${JSON.stringify(moduleUrl)};
    import { createManifest } from ${JSON.stringify(manifestUrl)};
    await assembleGeneration(process.argv[1], async ({outputRoot}) => {
      writeFileSync(path.join(outputRoot, 'new.js'), 'new');
      if (process.argv[2]==='stage') process.exit(23);
      return createManifest([{path:'new.js',contents:'new'}]);
    }, {report:()=>{},rename:(source,destination)=>{
      if (process.argv[2]==='before-backup') process.exit(23);
      renameSync(source,destination);
      if (path.basename(destination)===process.argv[2]) process.exit(23);
    }});
  `,
      root,
      stop,
    ],
    { encoding: 'utf8' },
  );
  expect(child.status, child.stderr).toBe(23);
  expect(recoverGeneration(root)).toEqual({ action });
  const expectedFile = installed ? 'new.js' : 'legacy.txt';
  expect(readFileSync(path.join(root, 'dist', expectedFile), 'utf8')).toBe(
    installed ? 'new' : 'uninterrupted bytes',
  );
  expect(existsSync(path.join(root, '.robota-artifacts/writer.lock'))).toBe(false);
});

it('restores the legacy directory if installing the new pointer fails', async () => {
  const root = realpathSync(makeTemp('robota-generation-rollback-'));
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/legacy.txt'), 'old');
  await expect(
    assembleGeneration(root, emitter('new'), {
      report: () => {},
      rename: (source, destination) => {
        if (path.basename(source).startsWith('.dist-')) throw new Error('install denied');
        renameSync(source, destination);
      },
    }),
  ).rejects.toThrow('install denied');
  expect(readFileSync(path.join(root, 'dist/legacy.txt'), 'utf8')).toBe('old');
  expect(existsSync(path.join(root, '.robota-artifacts/transaction.json'))).toBe(false);
  expect(existsSync(path.join(root, '.robota-artifacts/writer.lock'))).toBe(false);
});

it('rejects a managed pointer redirected outside its package-owned generation store', async () => {
  const outside = realpathSync(makeTemp('robota-generation-outside-'));
  const foreign = await assembleGeneration(outside, emitter('foreign'));
  const root = realpathSync(makeTemp('robota-generation-owner-'));
  symlinkSync(foreign.root, path.join(root, 'dist'), 'dir');
  expect(() => pinGeneration(root)).toThrow(/owned/);
});

it('serializes package writers and releases the lock after a failed staged build', async () => {
  const root = realpathSync(makeTemp('robota-generation-lock-'));
  const original = await assembleGeneration(root, emitter('original'));
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const active = assembleGeneration(root, async () => {
    await pending;
    throw new Error('declaration failed');
  });
  await expect(assembleGeneration(root, emitter('racing'))).rejects.toThrow(/writer lock/);
  release();
  await expect(active).rejects.toThrow('declaration failed');
  expect(pinGeneration(root)).toEqual(original);
  await expect(assembleGeneration(root, emitter('repaired'))).resolves.toHaveProperty('id');
});

it('announces the approved non-atomic legacy transition and retains its physical backup', async () => {
  const root = realpathSync(makeTemp('robota-generation-legacy-'));
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/legacy.txt'), 'keep this output');
  const notices = [];
  const generation = await assembleGeneration(root, emitter('complete'), {
    report: (event) => notices.push(event),
  });
  expect(notices).toEqual([
    expect.objectContaining({ type: 'non-atomic-transition', reason: 'legacy-dist' }),
  ]);
  expect(readFileSync(path.join(generation.root, '../previous-dist/legacy.txt'), 'utf8')).toBe(
    'keep this output',
  );
  expect(pinGeneration(root)).toEqual(generation);
});

it('keeps the old generation through Windows replacement failure without claiming atomicity', async () => {
  const root = realpathSync(makeTemp('robota-generation-windows-policy-'));
  const first = await assembleGeneration(root, emitter('first'), { platform: 'win32' });
  const notices = [];
  await expect(
    assembleGeneration(root, emitter('second'), {
      platform: 'win32',
      report: (event) => notices.push(event),
      rename: (source, destination) => {
        if (path.basename(source).startsWith('.dist-'))
          throw new Error('windows replacement denied');
        renameSync(source, destination);
      },
    }),
  ).rejects.toThrow('windows replacement denied');
  expect(notices).toEqual([expect.objectContaining({ reason: 'windows-replacement' })]);
  expect(pinGeneration(root)).toEqual(first);
});

it('retains recovery evidence when both replacement and restoration fail', async () => {
  const root = realpathSync(makeTemp('robota-generation-double-failure-'));
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/legacy.txt'), 'retained');
  await expect(
    assembleGeneration(root, emitter('new'), {
      report: () => {},
      rename: (source, destination) => {
        if (path.basename(destination) === 'dist') throw new Error('access denied');
        renameSync(source, destination);
      },
    }),
  ).rejects.toThrow(/recovery required/);
  const journal = JSON.parse(
    readFileSync(path.join(root, '.robota-artifacts/transaction.json'), 'utf8'),
  );
  const backup = path.join(root, '.robota-artifacts', journal.id, 'previous-dist/legacy.txt');
  expect(readFileSync(backup, 'utf8')).toBe('retained');
  await expect(assembleGeneration(root, emitter('retry'))).rejects.toThrow(/writer lock/);
  expect(() => recoverGeneration(root)).toThrow(/still running/);
});
