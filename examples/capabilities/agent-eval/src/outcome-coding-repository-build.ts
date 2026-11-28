/**
 * Builds the data of the repository-work task from two commits of this repository: the parent of a
 * merged fix and the fix itself. The tree comes from `git archive` (a plain export, so it has no
 * history and no pack objects that could hold the fix) and is cut down to the files the task needs.
 *
 *   tsx src/outcome-coding-repository-build.ts [--source <checkout>] [--out <data module>]
 *
 * The result is committed as `outcome-coding-tasks-repository-data.ts`; a test compares a fresh
 * build with it whenever the two commits are available locally.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { exportTree } from './outcome-coding-image.js';

export const REPOSITORY_FIXTURE_SOURCE = Object.freeze({
  /** The commit the task tree is exported from: the parent of the fix. */
  parentCommit: '726b30cfdae2a0a6f171aacf738f538f91a0efba',
  /** The merged fix; only its changes to `implementation` become the solved overlay. */
  fixCommit: '0d4a29336cb30fbf4e566200fda27476f3d19f0e',
  /** The one file the agent may change. */
  implementation: 'packages/agent-roundtable-robota/src/render.ts',
  /** Everything the task tree keeps from the parent; all else is pruned. */
  kept: Object.freeze([
    'packages/agent-roundtable-robota/src/render.ts',
    'packages/agent-roundtable-robota/package.json',
  ]),
  /** Files the fix changed, read for the lines that exist only in the fix. */
  changed: Object.freeze([
    'packages/agent-roundtable-robota/src/render.ts',
    'packages/agent-roundtable-robota/src/render.test.ts',
  ]),
});

/** Added lines shorter than this carry no signal and would match unrelated files. */
const MIN_NEEDLE_LENGTH = 40;

export interface IRepositoryFixture {
  readonly parentCommit: string;
  readonly fixCommit: string;
  readonly files: Readonly<Record<string, string>>;
  readonly solved: Readonly<Record<string, string>>;
  readonly leakNeedles: readonly string[];
}

function git(source: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', source, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  });
}

/** True when both commits are present in the checkout (a shallow clone has neither). */
export function hasFixtureCommits(source: string): boolean {
  try {
    for (const commit of [
      REPOSITORY_FIXTURE_SOURCE.parentCommit,
      REPOSITORY_FIXTURE_SOURCE.fixCommit,
    ]) {
      git(source, ['cat-file', '-e', `${commit}^{commit}`]);
    }
    return true;
  } catch {
    return false;
  }
}

/** Lines the fix added to the changed files that the parent versions do not contain. */
function addedLines(source: string): string[] {
  const { parentCommit, fixCommit, changed } = REPOSITORY_FIXTURE_SOURCE;
  const diff = git(source, ['diff', '--unified=0', parentCommit, fixCommit, '--', ...changed]);
  const parentText = changed
    .map((path) => git(source, ['show', `${parentCommit}:${path}`]))
    .join('\n');
  const found = new Set<string>();
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1).trim();
    if (text.length >= MIN_NEEDLE_LENGTH && !parentText.includes(text)) found.add(text);
  }
  return [...found];
}

export async function buildRepositoryFixture(source: string): Promise<IRepositoryFixture> {
  const { parentCommit, fixCommit, implementation, kept } = REPOSITORY_FIXTURE_SOURCE;
  const work = mkdtempSync(join(tmpdir(), 'coding-repository-fixture-'));
  try {
    const parent = join(work, 'parent');
    const fixed = join(work, 'fix');
    await exportTree(source, parentCommit, parent, kept);
    await exportTree(source, fixCommit, fixed, [implementation]);
    if (existsSync(join(parent, '.git'))) throw new Error('The exported tree must have no history');
    const files = Object.fromEntries(
      kept.map((path) => [path, readFileSync(join(parent, path), 'utf8')]),
    );
    return {
      parentCommit,
      fixCommit,
      files,
      solved: { [implementation]: readFileSync(join(fixed, implementation), 'utf8') },
      leakNeedles: addedLines(source),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function literalLines(text: string): string {
  const lines = text.split('\n');
  return `lines([\n${lines.map((line) => `    ${JSON.stringify(line)},`).join('\n')}\n  ])`;
}

/** The text of the data module for a fixture; prettier formats it afterwards. */
export function renderDataModule(fixture: IRepositoryFixture): string {
  const entries = (record: Readonly<Record<string, string>>): string =>
    Object.entries(record)
      .map(([path, text]) => `  ${JSON.stringify(path)}: ${literalLines(text)},`)
      .join('\n');
  return [
    '/**',
    ' * Generated by outcome-coding-repository-build.ts from two commits of this repository; do not edit.',
    " * The files are a plain export of the fix's parent commit, cut down to what the task needs and kept",
    " * byte for byte (so comments in them are the repository's own). `solved` holds the fix's version of",
    ' * the one implementation file, and `leakNeedles` the lines the fix added that the parent lacks.',
    ' */',
    '',
    '/** A file is stored as its lines; a trailing empty line stands for the final newline. */',
    "const lines = (value: readonly string[]): string => value.join('\\n');",
    '',
    `export const REPOSITORY_PARENT_COMMIT = ${JSON.stringify(fixture.parentCommit)};`,
    `export const REPOSITORY_FIX_COMMIT = ${JSON.stringify(fixture.fixCommit)};`,
    '',
    'export const REPOSITORY_FILES: Readonly<Record<string, string>> = {',
    entries(fixture.files),
    '};',
    '',
    'export const REPOSITORY_SOLVED: Readonly<Record<string, string>> = {',
    entries(fixture.solved),
    '};',
    '',
    'export const REPOSITORY_LEAK_NEEDLES: readonly string[] = [',
    ...fixture.leakNeedles.map((needle) => `  ${JSON.stringify(needle)},`),
    '];',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: resolve(here, '../../../..') },
      out: { type: 'string', default: join(here, 'outcome-coding-tasks-repository-data.ts') },
    },
  });
  const source = resolve(values.source as string);
  if (!hasFixtureCommits(source)) throw new Error('The checkout has no history for both commits');
  const fixture = await buildRepositoryFixture(source);
  writeFileSync(values.out as string, renderDataModule(fixture));
  console.log(`wrote ${values.out as string}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
