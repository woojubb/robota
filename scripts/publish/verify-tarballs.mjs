#!/usr/bin/env node
/**
 * Check packed tarballs before publishing:
 * - every file a package declares (main, module, types, exports, bin) is inside its tarball, and no
 *   `workspace:` specifier remains — catches a build that left `dist` empty or unpacked (for example a
 *   symlinked `dist`, which `pnpm pack` skips);
 * - `publint --strict` finds no errors or warnings in the package layout;
 * - `attw` (Are The Types Wrong) finds no type-resolution problem for Node 16+ ESM/CJS and bundlers.
 *   Subpaths that declare no `require` condition are ESM-only by design and are left out of attw;
 * - no browser entry (a `dist/browser/` file named in `exports`) reaches a `node:` builtin through its
 *   static imports. Dynamically imported chunks are Node-only paths loaded on demand and are allowed.
 *
 * Usage: node scripts/publish/verify-tarballs.mjs <directory-with-tgz-files>
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

function declaredPaths(manifest) {
  const paths = [];
  const collect = (value) => {
    if (typeof value === 'string') paths.push(value);
    else if (value && typeof value === 'object') {
      // `source` is the workspace-only development condition; it points at src/ and is never shipped.
      for (const [key, nested] of Object.entries(value)) if (key !== 'source') collect(nested);
    }
  };
  for (const key of ['main', 'module', 'types']) collect(manifest[key]);
  collect(manifest.exports);
  collect(manifest.bin);
  return [...new Set(paths)]
    .filter((entry) => !entry.includes('*') && !entry.endsWith('/'))
    .map((entry) => path.posix.normalize(entry.replace(/^\.\//u, '')));
}

const BIN = path.join(import.meta.dirname, '..', '..', 'node_modules', '.bin');
const TOOLS = {
  publint: ['publint', '--strict'],
  attw: ['attw', '--profile', 'node16'],
};

/** Export subpaths with no `require` condition anywhere: intentionally ESM-only. */
function esmOnlySubpaths(manifest) {
  if (!manifest.exports || typeof manifest.exports !== 'object') return [];
  return Object.entries(manifest.exports)
    .filter(
      ([, entry]) =>
        entry && typeof entry === 'object' && !JSON.stringify(entry).includes('"require"'),
    )
    .map(([subpath]) => subpath);
}

const read = (tarball, file) =>
  execFileSync('tar', ['-xzOf', tarball, `package/${file}`], { encoding: 'utf8' });

function browserBuiltinProblems(tarball, manifest, files) {
  const entries = declaredPaths({ exports: manifest.exports }).filter((file) =>
    /^dist\/browser\/.+\.m?js$/u.test(file),
  );
  const problems = [];
  for (const entry of entries) {
    const seen = new Set();
    const queue = [entry];
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file) || !files.has(file)) continue;
      seen.add(file);
      const code = read(tarball, file);
      const builtins = [...code.matchAll(/(?:from\s*|import\s*)["'](node:[^"']+)["']/gu)].map(
        (match) => match[1],
      );
      if (builtins.length)
        problems.push(`${entry} reaches ${[...new Set(builtins)].join(', ')} via ${file}`);
      for (const match of code.matchAll(/from\s*["'](\.\.?\/[^"']+)["']/gu))
        queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
    }
  }
  return problems;
}

function runTool(name, tarball, extraArgs = []) {
  const [bin, ...args] = TOOLS[name];
  try {
    execFileSync(path.join(BIN, bin), [tarball, ...args, ...extraArgs], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return [];
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return [`${name} failed:\n${output}`];
  }
}

export function verifyTarball(tarball) {
  const files = new Set(
    execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//u, '')),
  );
  const raw = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
  const manifest = JSON.parse(raw);
  const problems = declaredPaths(manifest)
    .filter((entry) => !files.has(entry))
    .map((entry) => `declares ${entry} but the tarball does not contain it`);
  if (raw.includes('"workspace:')) problems.push('still contains a workspace: specifier');
  const esmOnly = esmOnlySubpaths(manifest);
  problems.push(
    ...runTool('publint', tarball),
    ...runTool('attw', tarball, esmOnly.length ? ['--exclude-entrypoints', ...esmOnly] : []),
  );
  problems.push(...browserBuiltinProblems(tarball, manifest, files));
  return { name: manifest.name, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const directory = process.argv[2];
  if (!directory) {
    process.stderr.write('usage: verify-tarballs.mjs <directory>\n');
    process.exit(1);
  }
  const tarballs = readdirSync(directory).filter((file) => file.endsWith('.tgz'));
  let failed = 0;
  for (const file of tarballs) {
    const { name, problems } = verifyTarball(path.join(directory, file));
    for (const problem of problems) process.stderr.write(`❌ ${name}: ${problem}\n`);
    if (problems.length) failed += 1;
  }
  if (tarballs.length === 0 || failed > 0) {
    process.stderr.write(`Tarball check failed (${failed} of ${tarballs.length} packages).\n`);
    process.exit(1);
  }
  process.stdout.write(
    `✓ ${tarballs.length} tarballs contain every declared file and pass publint and attw\n`,
  );
}
