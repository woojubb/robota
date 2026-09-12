import { existsSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unrun } from 'unrun';
import { validateArtifactPath } from './manifest.mjs';

export function prepareTsdownConfig(config, { packageRoot, outputRoot }) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid tsdown configuration');
  }
  if (
    config.watch ||
    config.workspace ||
    (config.cwd && path.resolve(packageRoot, config.cwd) !== packageRoot)
  ) {
    throw new Error(
      'tsdown watch, workspace or foreign cwd cannot produce one sealed package generation',
    );
  }
  if (
    typeof config.outputOptions === 'function' ||
    config.outputOptions?.dir ||
    config.outputOptions?.file
  ) {
    throw new Error('tsdown outputOptions cannot override the staged output directory');
  }
  const relative = path.relative(
    path.join(packageRoot, 'dist'),
    path.resolve(packageRoot, config.outDir ?? 'dist'),
  );
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`tsdown outDir must be inside package dist: ${config.outDir}`);
  }
  return {
    ...config,
    config: false,
    cwd: packageRoot,
    outDir: path.join(outputRoot, relative),
    clean: false,
    logLevel: 'warn',
  };
}

/** Compiler configuration remains the owner of entries, formats and output layout. */
export async function emitTsdown({ packageRoot, outputRoot }) {
  const root = path.resolve(packageRoot);
  const require = createRequire(path.join(root, 'package.json'));
  // Optional adapter dependency: resolve the compiler from its owning package, never a sibling.
  const { build } = await import(pathToFileURL(require.resolve('tsdown')).href);
  const configPath = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']
    .map((extension) => path.join(root, `tsdown.config.${extension}`))
    .find((candidate) => existsSync(candidate));
  if (!configPath) throw new Error(`Missing tsdown configuration: ${root}`);
  // Use the compiler's existing config loader dependency without process-global namespace hooks.
  // API callers need not chdir: external config imports resolve from the package, not unrun's cache.
  const { module: exported } = await unrun({
    path: pathToFileURL(configPath),
    inputOptions: { cwd: root },
    outputOptions: {
      paths: (id) => (isBuiltin(id) ? id : pathToFileURL(require.resolve(id)).href),
    },
  });
  const value = typeof exported === 'function' ? await exported({ cwd: root }) : await exported;
  const configs = Array.isArray(value) ? value : [value];
  const records = new Map();
  for (const config of configs) {
    const bundles = await build(prepareTsdownConfig(config, { packageRoot: root, outputRoot }));
    for (const bundle of bundles) {
      for (const chunk of bundle.chunks) {
        const file = path
          .relative(outputRoot, path.resolve(chunk.outDir, chunk.fileName))
          .split(path.sep)
          .join('/');
        validateArtifactPath(file);
        const contents = chunk.type === 'chunk' ? chunk.code : chunk.source;
        const mode = typeof contents === 'string' && contents.startsWith('#!') ? 0o755 : 0o644;
        const prior = records.get(file);
        if (prior && !Buffer.from(prior.contents).equals(Buffer.from(contents))) {
          throw new Error(`Conflicting compiler emissions: ${file}`);
        }
        records.set(file, { path: file, contents, mode });
      }
    }
  }
  if (records.size === 0) throw new Error('tsdown emitted no artifacts');
  return [...records.values()];
}
