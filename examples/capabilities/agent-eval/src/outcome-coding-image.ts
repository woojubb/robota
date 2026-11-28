import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ICodingTaskDefinition } from './outcome-coding-tasks.js';

/**
 * The worker image is built from a clean export of a pinned commit, with no history, and with
 * everything that could reveal an answer removed before the build: solutions, verifiers, their
 * scoring and the earlier harness. The context is then searched for what must not be there, and so
 * is the built image.
 */

const EXAMPLE_DIR = 'examples/capabilities/agent-eval';
/** The only example files that reach the image: its manifest and the worker with its protocol. */
const EXAMPLE_KEPT_FILES = ['package.json', 'tsconfig.json'];
const WORKER_FILES = [
  'src/outcome-coding-worker.ts',
  'src/outcome-coding-protocol.ts',
  'src/outcome-delegation-limits.ts',
  'src/outcome-delegation-roles.ts',
];
/** Directories removed from the export entirely. */
const EXCLUDED_DIRECTORIES = ['research'];

/** Names that mark a file as a task, solution, verifier or earlier-harness file. */
export const FORBIDDEN_PATH_FRAGMENTS: readonly string[] = [
  'outcome-coding-tasks',
  'outcome-coding-verify',
  'outcome-coding-score',
  'outcome-delegation-scripts',
  'outcome-delegation-measures',
  'delegation-topology',
];

/** Files whose names say they hold a credential: environment files (not their examples or defaults), keys, certificates. */
export const CREDENTIAL_FILE_PATTERN =
  /(^|\/)(\.env(\.(?!example$|sample$|template$|default$)[^/]*)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)[^/]*)$/;

/** Identifiers that occur only in the task fixtures and their solutions. */
export const TASK_MARKERS: readonly string[] = [
  'normalizeSku',
  'totalCents',
  'formatMoney',
  'invoiceTotal',
  'priceCents',
];

/** The exact texts that must appear nowhere in the image: every solved file and every verifier. */
export function forbiddenTexts(tasks: readonly ICodingTaskDefinition[]): string[] {
  return [
    ...new Set([
      ...tasks.flatMap((task) => [
        task.verifier,
        ...Object.values(task.solved),
        ...(task.leakNeedles ?? []),
      ]),
      ...TASK_MARKERS,
    ]),
  ];
}

/**
 * Lines that exist only in a real fix. The repository at the pinned commit already contains that
 * fix, so every file carrying one of them is removed from the exported tree before the build.
 */
export function leakNeedles(tasks: readonly ICodingTaskDefinition[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.leakNeedles ?? []))];
}

export interface IPnpmPin {
  readonly version: string;
}

/** The package manager version the checked-out tree pins. */
export function readPnpmPin(root: string): IPnpmPin {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    packageManager?: string;
  };
  const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(manifest.packageManager ?? '');
  if (match?.[1] === undefined) throw new Error('The tree does not pin pnpm in packageManager');
  return { version: match[1] };
}

export function renderDockerfile(options: {
  readonly nodeImage: string;
  readonly pnpmVersion: string;
  readonly commit: string;
}): string {
  return [
    `FROM ${options.nodeImage}`,
    'RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \\',
    ' && rm -rf /var/lib/apt/lists/*',
    'WORKDIR /opt/robota',
    'COPY robota/ ./',
    `RUN corepack enable && corepack prepare pnpm@${options.pnpmVersion} --activate \\`,
    ' && pnpm install --filter robota-capability-agent-eval... --frozen-lockfile --ignore-scripts',
    `LABEL robota.eval=coding-worker robota.eval.commit=${options.commit}`,
    'ENV HOME=/tmp/home PRODUCT_USER_STATE_DIR=/tmp/state',
    `WORKDIR /opt/robota/${EXAMPLE_DIR}`,
    'CMD ["./node_modules/.bin/tsx", "--conditions=source", "src/outcome-coding-worker.ts"]',
    '',
  ].join('\n');
}

function run(command: string, args: readonly string[], cwd?: string): string {
  const result = spawnSync(command, [...args], {
    ...(cwd === undefined ? {} : { cwd }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.slice(-800)}`);
  }
  return result.stdout.trim();
}

/** Resolves a revision to a commit in the checkout. */
export function resolveCommit(source: string, revision: string): string {
  return run('git', ['-C', source, 'rev-parse', '--verify', `${revision}^{commit}`]);
}

/** Exports a commit's tree (optionally only some paths) with no history: `git archive` piped into `tar`. */
export function exportTree(
  source: string,
  commit: string,
  destination: string,
  paths: readonly string[] = [],
): Promise<void> {
  mkdirSync(destination, { recursive: true });
  return new Promise((done, fail) => {
    const archive = spawn('git', ['-C', source, 'archive', '--format=tar', commit, ...paths], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const extract = spawn('tar', ['-x', '-C', destination], { stdio: ['pipe', 'ignore', 'pipe'] });
    archive.stdout.pipe(extract.stdin);
    let failure = '';
    archive.stderr.on('data', (chunk: Buffer) => (failure += chunk.toString()));
    extract.stderr.on('data', (chunk: Buffer) => (failure += chunk.toString()));
    let pending = 2;
    const finish = (code: number | null): void => {
      if (code !== 0) fail(new Error(`exporting ${commit} failed: ${failure.slice(-800)}`));
      else if (--pending === 0) done();
    };
    archive.on('close', finish);
    extract.on('close', finish);
    archive.on('error', fail);
    extract.on('error', fail);
  });
}

function* walkFiles(root: string): Generator<string> {
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stat = lstatSync(path);
      if (stat.isDirectory()) stack.push(path);
      else if (stat.isFile()) yield path;
    }
  }
}

const MAX_SEARCHED_BYTES = 16 * 1024 * 1024;

/**
 * Removes what the worker must not see from an exported tree, keeping the worker and its manifest.
 * Any other file holding one of `excludeFilesContaining` (lines of a real fix) is removed too.
 */
export function pruneExport(
  exported: string,
  excludeFilesContaining: readonly string[] = [],
): void {
  const example = join(exported, EXAMPLE_DIR);
  const kept = new Map<string, Buffer>();
  for (const file of [...EXAMPLE_KEPT_FILES, ...WORKER_FILES]) {
    kept.set(file, readFileSync(join(example, file)));
  }
  rmSync(example, { recursive: true, force: true });
  for (const [file, content] of kept) {
    mkdirSync(join(example, file, '..'), { recursive: true });
    writeFileSync(join(example, file), content);
  }
  for (const directory of EXCLUDED_DIRECTORIES) {
    rmSync(join(exported, directory), { recursive: true, force: true });
  }
  if (excludeFilesContaining.length === 0) return;
  for (const path of [...walkFiles(exported)]) {
    if (lstatSync(path).size > MAX_SEARCHED_BYTES) continue;
    const content = readFileSync(path);
    if (excludeFilesContaining.some((needle) => content.includes(needle))) rmSync(path);
  }
}

export interface IImageContext {
  readonly directory: string;
  /** The tree the image copies. */
  readonly tree: string;
  readonly commit: string;
}

/**
 * Builds the docker context for a commit: an exported tree (so no history and no pack objects),
 * pruned, with the Dockerfile beside it. Returns the commit that was exported.
 */
export async function assembleImageContext(options: {
  readonly source: string;
  readonly revision: string;
  readonly directory: string;
  readonly nodeImage: string;
  /** Lines of a real fix: files holding one are left out of the image (see `leakNeedles`). */
  readonly excludeFilesContaining?: readonly string[];
}): Promise<IImageContext> {
  const commit = resolveCommit(options.source, options.revision);
  const tree = join(options.directory, 'robota');
  await exportTree(options.source, commit, tree);
  pruneExport(tree, options.excludeFilesContaining);
  const pin = readPnpmPin(tree);
  writeFileSync(
    join(options.directory, 'Dockerfile'),
    renderDockerfile({ nodeImage: options.nodeImage, pnpmVersion: pin.version, commit }),
  );
  return { directory: options.directory, tree, commit };
}

export interface ISearchHit {
  readonly path: string;
  readonly reason: string;
}

/** Searches a host directory for forbidden path fragments and forbidden texts. */
export function searchTree(
  root: string,
  texts: readonly string[],
): { scanned: number; hits: ISearchHit[] } {
  const hits: ISearchHit[] = [];
  let scanned = 0;
  if (!existsSync(root)) return { scanned, hits };
  for (const path of walkFiles(root)) {
    scanned += 1;
    const shown = relative(root, path).split(sep).join('/');
    const fragment = FORBIDDEN_PATH_FRAGMENTS.find((candidate) => shown.includes(candidate));
    if (fragment !== undefined) hits.push({ path: shown, reason: `path contains ${fragment}` });
    if (CREDENTIAL_FILE_PATTERN.test(shown))
      hits.push({ path: shown, reason: 'credential-like file name' });
    if (lstatSync(path).size > MAX_SEARCHED_BYTES) continue;
    const content = readFileSync(path);
    const text = texts.find((candidate) => content.includes(candidate));
    if (text !== undefined) hits.push({ path: shown, reason: 'contains a forbidden text' });
  }
  return { scanned, hits };
}

/** The in-container search: the same rules, run over the image's whole file system. */
const IMAGE_SEARCH_SCRIPT = `
const fs = require('node:fs');
const { fragments, texts, credential } = JSON.parse(fs.readFileSync('/search/needles.json', 'utf8'));
const skip = new Set(['/proc', '/sys', '/dev', '/search', '/tmp']);
const credentialName = new RegExp(credential);
const hits = []; let scanned = 0;
const stack = ['/'];
while (stack.length) {
  const dir = stack.pop();
  let entries;
  try { entries = fs.readdirSync(dir); } catch { continue; }
  for (const entry of entries) {
    const path = (dir === '/' ? '' : dir) + '/' + entry;
    if (skip.has(path)) continue;
    let stat;
    try { stat = fs.lstatSync(path); } catch { continue; }
    if (stat.isDirectory()) { stack.push(path); continue; }
    if (!stat.isFile()) continue;
    scanned += 1;
    const fragment = fragments.find((f) => path.includes(f));
    if (fragment) hits.push({ path, reason: 'path contains ' + fragment });
    if (credentialName.test(path.slice(1))) hits.push({ path, reason: 'credential-like file name' });
    if (stat.size > ${MAX_SEARCHED_BYTES}) continue;
    let content;
    try { content = fs.readFileSync(path); } catch { continue; }
    if (texts.some((t) => content.includes(t))) hits.push({ path, reason: 'contains a forbidden text' });
  }
}
process.stdout.write(JSON.stringify({ scanned, hits }));
`;

/** Searches the built image's whole file system for what must not be there. */
export function searchImage(
  image: string,
  needlesDirectory: string,
  texts: readonly string[],
): { scanned: number; hits: ISearchHit[] } {
  writeFileSync(
    join(needlesDirectory, 'needles.json'),
    JSON.stringify({
      fragments: FORBIDDEN_PATH_FRAGMENTS,
      texts,
      credential: CREDENTIAL_FILE_PATTERN.source,
    }),
  );
  const output = run('docker', [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--user',
    '1000:1000',
    '-v',
    `${needlesDirectory}:/search:ro`,
    image,
    'node',
    '-e',
    IMAGE_SEARCH_SCRIPT,
  ]);
  return JSON.parse(output) as { scanned: number; hits: ISearchHit[] };
}

export function buildImage(context: IImageContext, tag: string): void {
  run('docker', ['build', '--pull=false', '-t', tag, context.directory]);
}

export function removeImage(tag: string): void {
  spawnSync('docker', ['rmi', '-f', tag], { stdio: 'ignore' });
}
