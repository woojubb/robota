#!/usr/bin/env node
import { lstatSync, readdirSync, realpathSync, watch } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPackage } from './build-package.mjs';

const EXCLUDED = new Set(['node_modules', '.robota-artifacts', 'dist', 'dist-bun', '.git']);
const isConfig = (name) =>
  name === 'package.json' ||
  /^(?:tsdown|tsup|vite|tsconfig)(?:[.-].+)?\.(?:[cm]?[jt]s|json)$/u.test(name);

/** Watch inputs only; the existing assembler/emitter/lock owns every output write. */
export function watchPackage(
  packageRoot = process.cwd(),
  {
    build = buildPackage,
    watchDirectory = watch,
    signals = process,
    onError = (error) => process.stderr.write(`artifact watch failed: ${error.stack ?? error}\n`),
    onBuilt = (generation) =>
      process.stdout.write(
        `artifact watch generation ${generation.id}: ${generation.manifest.files.length} files\n`,
      ),
  } = {},
) {
  const root = realpathSync(packageRoot);
  const watchers = new Map();
  let closed = false;
  let pending = false;
  let scheduled = false;
  let running = Promise.resolve();

  function requestBuild() {
    if (closed) return;
    pending = true;
    if (scheduled) return;
    scheduled = true;
    // Let native watcher registration reach the event loop before starting compiler work.
    running = new Promise((resolve) => setImmediate(resolve)).then(async () => {
      try {
        while (pending && !closed) {
          pending = false;
          try {
            onBuilt(await build(root));
          } catch (error) {
            onError(error);
          }
        }
      } finally {
        scheduled = false;
      }
    });
  }

  function close() {
    closed = true;
    pending = false;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    signals.removeListener('SIGINT', close);
    signals.removeListener('SIGTERM', close);
    return running;
  }

  function fail(error) {
    onError(error);
    void close();
  }

  function register(directory, listener) {
    if (watchers.has(directory)) return;
    const watcher = watchDirectory(directory, { recursive: false }, listener);
    watcher.on('error', fail);
    watchers.set(directory, watcher);
  }

  function refreshSources() {
    const seen = new Set([root]);
    const visit = (directory) => {
      if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return;
      seen.add(directory);
      register(directory, (_event, filename) => {
        if (closed) return;
        const name = filename?.toString();
        if (
          name &&
          (EXCLUDED.has(name) ||
            lstatSync(path.join(directory, name), { throwIfNoEntry: false })?.isSymbolicLink())
        )
          return;
        try {
          refreshSources();
          requestBuild();
        } catch (error) {
          fail(error);
        }
      });
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !EXCLUDED.has(entry.name))
          visit(path.join(directory, entry.name));
      }
    };
    visit(path.join(root, 'src'));
    for (const [directory, watcher] of watchers) {
      if (!seen.has(directory)) {
        watcher.close();
        watchers.delete(directory);
      }
    }
  }

  try {
    register(root, (_event, filename) => {
      if (closed) return;
      if (filename === null) {
        fail(new Error('Cannot identify changed package-root input'));
        return;
      }
      const name = filename.toString();
      if (name !== 'src' && !isConfig(name)) return;
      try {
        refreshSources();
        requestBuild();
      } catch (error) {
        fail(error);
      }
    });
    refreshSources();
    signals.on('SIGINT', close);
    signals.on('SIGTERM', close);
    // Registration precedes initial assembly, so edits during it leave one pending rebuild.
    requestBuild();
  } catch (error) {
    void close();
    throw error;
  }
  return { close, ready: running, whenIdle: () => running };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    watchPackage(undefined, {
      onError: (error) => {
        process.stderr.write(`artifact watch failed: ${error.stack ?? error}\n`);
        process.exitCode = 1;
      },
      onBuilt: (generation) => {
        process.stdout.write(
          `artifact watch generation ${generation.id}: ${generation.manifest.files.length} files\n`,
        );
      },
    });
  } catch (error) {
    process.stderr.write(`artifact watch failed: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
