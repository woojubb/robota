import { mkdirSync, readFileSync, symlinkSync, writeFileSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { buildPackage } from '../build-package.mjs';
import { pinGeneration } from '../generation.mjs';
import { watchPackage } from '../watch-package.mjs';

async function fixture() {
  const root = makeTemp('artifact-watch-');
  mkdirSync(path.join(root, 'src/nested'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules'));
  const require = createRequire(
    path.resolve(import.meta.dirname, '../../../packages/agent-core/package.json'),
  );
  const compiler = require.resolve('tsdown');
  symlinkSync(
    path.resolve(path.dirname(compiler), '..'),
    path.join(root, 'node_modules/tsdown'),
    'junction',
  );
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: '@fixture/watch',
      type: 'module',
      robota: { artifact: { builder: 'tsdown' } },
    }),
  );
  writeFileSync(
    path.join(root, 'tsdown.config.mjs'),
    "export default {entry:['src/nested/index.ts'],format:['esm'],dts:false,outDir:'dist/node'};",
  );
  writeFileSync(path.join(root, 'src/nested/index.ts'), 'export const answer = 1;');
  return { root, compiler };
}

it('keeps the previous sealed generation immutable across a compiler input change', async () => {
  const { root } = await fixture();
  const previous = await buildPackage(root);
  const previousFile = path.join(previous.root, previous.manifest.files[0].path);
  const before = readFileSync(previousFile, 'utf8');
  const generations = [];
  const errors = [];
  const events = [];
  const watcher = watchPackage(root, {
    onBuilt: (value) => generations.push(value),
    onError: (error) => errors.push(error),
    watchDirectory: (directory, options, listener) =>
      watch(directory, options, (event, name) => {
        events.push([directory, event, name]);
        listener(event, name);
      }),
  });
  try {
    await watcher.ready;
    writeFileSync(path.join(root, 'src/nested/index.ts'), 'export const answer = 2;');
    await vi.waitFor(
      () => {
        expect(errors).toEqual([]);
        expect(generations.length, JSON.stringify(events)).toBeGreaterThan(1);
      },
      { timeout: 5000, interval: 20 },
    );
    writeFileSync(
      path.join(root, 'tsdown.config.mjs'),
      "export default {entry:['src/nested/index.ts'],format:['esm'],dts:false,outDir:'dist/config-changed'};",
    );
    await vi.waitFor(
      () => {
        expect(
          pinGeneration(root).manifest.files.every((file) =>
            file.path.startsWith('config-changed/'),
          ),
        ).toBe(true);
      },
      { timeout: 5000, interval: 20 },
    );
    expect(readFileSync(previousFile, 'utf8')).toBe(before);
    expect(pinGeneration(root).id).not.toBe(previous.id);
    expect(errors).toEqual([]);
    await watcher.whenIdle();
    const valid = pinGeneration(root);
    expect(readFileSync(path.join(valid.root, valid.manifest.files[0].path), 'utf8')).toContain(
      'answer = 2',
    );
    writeFileSync(path.join(root, 'src/nested/index.ts'), 'export const = ;');
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), {
      timeout: 5000,
      interval: 20,
    });
    await watcher.whenIdle();
    expect(errors[0]).toBeInstanceOf(Error);
    expect(pinGeneration(root).id).toBe(valid.id);
    writeFileSync(path.join(root, 'src/nested/index.ts'), 'export const answer = 3;');
    await vi.waitFor(
      () => {
        const recovered = pinGeneration(root);
        expect(recovered.id).not.toBe(valid.id);
        expect(
          readFileSync(path.join(recovered.root, recovered.manifest.files[0].path), 'utf8'),
        ).toContain('answer = 3');
      },
      { timeout: 5000, interval: 20 },
    );
    expect(readFileSync(previousFile, 'utf8')).toBe(before);
  } finally {
    await watcher.close();
  }
});

it.each(['SIGINT', 'SIGTERM'])(
  'ignores queued filesystem callbacks after %s shutdown',
  async (signal) => {
    const { root } = await fixture();
    const signals = new EventEmitter();
    const registrations = [];
    const watcher = watchPackage(root, {
      signals,
      build: async () => ({ id: 'fixture', manifest: { files: [] } }),
      onBuilt() {},
      watchDirectory: (directory, options, listener) => {
        const handle = new EventEmitter();
        handle.close = vi.fn();
        registrations.push({ directory, options, listener, handle });
        return handle;
      },
    });
    await watcher.ready;
    signals.emit(signal);
    await watcher.close();
    const count = registrations.length;
    mkdirSync(path.join(root, 'src/new-directory'));
    registrations
      .find((item) => item.directory.endsWith('/src'))
      .listener('rename', 'new-directory');
    expect(registrations).toHaveLength(count);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(registrations.every((item) => item.handle.close.mock.calls.length > 0)).toBe(true);
  },
);

it('registers owned inputs before building, serializes pending edits, and never watches outputs or symlinks', async () => {
  const { root } = await fixture();
  for (const name of ['node_modules', 'dist', 'dist-bun', '.robota-artifacts'])
    mkdirSync(path.join(root, 'src', name));
  const outside = makeTemp('artifact-watch-outside-');
  symlinkSync(outside, path.join(root, 'src/linked'), 'junction');
  const registrations = [];
  const releases = [];
  let active = 0;
  let peak = 0;
  const build = vi.fn(() => {
    expect(registrations).toHaveLength(3);
    peak = Math.max(peak, ++active);
    return new Promise((resolve) =>
      releases.push(() => {
        active--;
        resolve({ id: 'fixture', manifest: { files: [] } });
      }),
    );
  });
  const watcher = watchPackage(root, {
    build,
    signals: new EventEmitter(),
    onBuilt() {},
    watchDirectory: (directory, options, listener) => {
      const handle = new EventEmitter();
      handle.close = vi.fn();
      registrations.push({ directory, options, listener, handle });
      return handle;
    },
  });
  try {
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    const owner = registrations[0];
    const source = registrations.find((item) => item.directory.endsWith('/src'));
    expect(registrations.every((item) => item.options.recursive === false)).toBe(true);
    expect(registrations.map((item) => path.relative(owner.directory, item.directory))).toEqual([
      '',
      'src',
      path.join('src', 'nested'),
    ]);
    source.listener('change', 'node_modules');
    source.listener('change', 'linked');
    owner.listener('rename', '.robota-artifacts');
    owner.listener('rename', 'dist');
    releases.shift()();
    await watcher.ready;
    expect(build).toHaveBeenCalledTimes(1);
    owner.listener('change', 'tsdown.config.mjs');
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    source.listener('change', 'index.ts');
    source.listener('change', 'index.ts');
    owner.listener('change', 'tsconfig.build.json');
    expect(build).toHaveBeenCalledTimes(2);
    releases.shift()();
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(3));
    releases.shift()();
    await watcher.whenIdle();
    expect(peak).toBe(1);
    expect(build).toHaveBeenCalledTimes(3);
  } finally {
    const closing = watcher.close();
    for (const release of releases) release();
    await closing;
  }
});
