import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { neutralShippedProblems } from '../publish/verify-tarballs.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A packed tarball with `exports` and the given dist files; returns what the check reads. */
function tarball(exports, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'neutral-tarball-'));
  roots.push(root);
  const manifest = { name: '@robota-sdk/fixture', version: '1.0.0', type: 'module', exports };
  for (const [file, content] of Object.entries({
    'package.json': JSON.stringify(manifest),
    ...files,
  })) {
    mkdirSync(path.dirname(path.join(root, 'package', file)), { recursive: true });
    writeFileSync(path.join(root, 'package', file), content);
  }
  const archive = path.join(root, 'fixture.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'package']);
  const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//u, ''));
  return [archive, manifest, new Set(listed)];
}

describe('neutral shipped-file check', () => {
  it('reports a Node built-in reached by a static import, import() or require(), bare or node:', () => {
    const problems = neutralShippedProblems(
      ...tarball(
        { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
        {
          'dist/index.js': 'import{a}from"./a.js";export const lazy=()=>import("./lazy.js");',
          'dist/a.js': 'import{readFileSync}from"fs";export const a=readFileSync;',
          'dist/lazy.js': 'export * from "node:child_process";',
          'dist/index.cjs': 'module.exports = require("node:os");',
        },
      ),
    );
    expect(problems.sort()).toEqual(
      [
        'dist/index.cjs reaches node:os via dist/index.cjs',
        'dist/index.js reaches fs via dist/a.js',
        'dist/index.js reaches node:child_process via dist/lazy.js',
      ].sort(),
    );
  });

  it('skips a subpath that maps browser: null', () => {
    const problems = neutralShippedProblems(
      ...tarball(
        {
          '.': { import: './dist/index.js' },
          './node': { browser: null, import: './dist/node.js' },
        },
        { 'dist/index.js': 'export const a = 1;', 'dist/node.js': 'import "node:fs";' },
      ),
    );
    expect(problems).toEqual([]);
  });
});
