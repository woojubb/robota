#!/usr/bin/env node
/**
 * Check packed tarballs before publishing: every file a package declares (main, module, types, exports,
 * bin) must be inside its tarball, and no `workspace:` specifier may remain. Catches a build that left
 * `dist` empty or unpacked (for example a symlinked `dist`, which `pnpm pack` skips).
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
  process.stdout.write(`✓ ${tarballs.length} tarballs contain every declared file\n`);
}
