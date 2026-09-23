import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateArtifactPath } from './manifest.mjs';

/** These are declared source inputs, not an enumeration of the output being verified. */
function publicInputs(root, prefix = '') {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink()) throw new Error(`Vite public input is a symlink: ${root}`);
  return readdirSync(root).flatMap((name) => {
    const source = path.join(root, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`Vite public input is a symlink: ${source}`);
    if (stat.isDirectory()) return publicInputs(source, relative);
    if (!stat.isFile()) throw new Error(`Vite public input is not a regular file: ${source}`);
    return [{ path: validateArtifactPath(relative), contents: readFileSync(source), mode: 0o644 }];
  });
}

export function prepareViteConfig(config, { packageRoot, outputRoot }) {
  const sourceRoot = path.resolve(packageRoot, config.root ?? '.');
  const relative = path.relative(
    path.join(packageRoot, 'dist'),
    path.resolve(sourceRoot, config.build?.outDir ?? 'dist'),
  );
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Vite outDir must be inside package dist: ${config.build?.outDir}`);
  }
  if (config.build?.watch) throw new Error('Vite watch cannot produce a sealed generation');
  const outputs = config.build?.rollupOptions?.output ?? [];
  if ((Array.isArray(outputs) ? outputs : [outputs]).some((output) => output.dir || output.file)) {
    throw new Error('Vite Rollup output cannot override the staged output directory');
  }
  return {
    ...config,
    configFile: false,
    root: sourceRoot,
    publicDir: false,
    logLevel: 'warn',
    build: {
      ...config.build,
      outDir: path.join(outputRoot, relative),
      emptyOutDir: false,
      write: true,
      copyPublicDir: false,
    },
  };
}

function materializePublicInputs(inputs, emitted, relative, outputRoot) {
  return inputs.map((input) => {
    const file = validateArtifactPath(
      path.posix.join(relative.split(path.sep).join('/'), input.path),
    );
    if (emitted.some((record) => record.path === file)) {
      throw new Error(`Vite public/emitted collision: ${file}`);
    }
    mkdirSync(path.dirname(path.join(outputRoot, file)), { recursive: true });
    writeFileSync(path.join(outputRoot, file), input.contents, { mode: input.mode, flag: 'wx' });
    return { ...input, path: file };
  });
}

export async function emitVite({ packageRoot, outputRoot }) {
  const root = realpathSync(packageRoot);
  const require = createRequire(path.join(root, 'package.json'));
  // Optional adapter dependency: Vite is provided by the package declaring this builder.
  const { build, loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')).href);
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    undefined,
    root,
  );
  if (!loaded) throw new Error(`Missing Vite configuration: ${root}`);
  const config = loaded.config;
  const prepared = prepareViteConfig(config, { packageRoot: root, outputRoot });
  const relative = path.relative(outputRoot, prepared.build.outDir);
  const inputs =
    config.publicDir === false || config.build?.copyPublicDir === false
      ? []
      : publicInputs(path.resolve(prepared.root, config.publicDir ?? 'public'));
  const result = await build(prepared);
  const outputs = Array.isArray(result) ? result : [result];
  const records = outputs.flatMap((output) =>
    output.output.map((chunk) => ({
      path: validateArtifactPath(
        path.posix.join(relative.split(path.sep).join('/'), validateArtifactPath(chunk.fileName)),
      ),
      contents: chunk.type === 'chunk' ? chunk.code : chunk.source,
      mode: 0o644,
    })),
  );
  const complete = [...records, ...materializePublicInputs(inputs, records, relative, outputRoot)];
  if (complete.length === 0) throw new Error('Vite emitted no artifacts');
  return complete;
}
