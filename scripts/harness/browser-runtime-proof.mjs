#!/usr/bin/env node

/**
 * The dynamic half of the "Runtime platforms" rule in ARCHITECTURE.md.
 *
 * `check-platform-neutral.mjs` proves by reading source that a platform-neutral entry reaches no Node
 * built-in and no Node global. This proves it by running: each neutral subpath of each package on the
 * Platform-neutral list is bundled the way a browser build bundles it (`platform: 'browser'`, ESM,
 * workspace packages from their `source`), and the bundle is evaluated in a realm that has only
 * web-standard globals (`browser-proof/web-globals.mjs`) — no `process`, `require`, `Buffer`,
 * `global`, `setImmediate` or `__dirname`. A reference to one fails with its name and the source line,
 * which a scan cannot see in a third-party dependency that reads `process.env` at call time.
 *
 * Two kinds of job, both against the bundle:
 *  - `load`: the entry evaluates. Every neutral subpath of every listed package.
 *  - `scenario`: `browser-proof/<package>.scenario.mjs` drives the package and asserts what it
 *    observes: a turn, a request the `fetch` stub received, a refusal. Another file in that directory
 *    is picked up by its name; its package must be on the Platform-neutral list.
 *
 * A bundle that imports a Node built-in (or another package's Node-only subpath) fails, except a
 * dynamic import inside a third-party module, which the static check also allows: it is a runtime
 * detection that does not run here. Such an import resolves to a module that throws, as a browser
 * build's stub would.
 *
 *   node scripts/harness/browser-runtime-proof.mjs [--root <workspace>] [--out <dir>]
 *
 * `--out` keeps the bundles (and their source maps) in <dir>, for loading them in a real browser.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { SourceMap } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

import {
  ASSET_LOADERS,
  documentedPlatforms,
  isBuiltin,
  isNodeOnly,
  loadWorkspace,
  pick,
} from './check-platform-neutral.mjs';
import { isEntryPoint } from './entrypoint.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';
import { REALM_GLOBAL_NAMES } from './browser-proof/web-globals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROOF_DIR = path.join(here, 'browser-proof');
const REALM = path.join(PROOF_DIR, 'realm.mjs');
const INSTALL = path.join(PROOF_DIR, 'install.mjs');
const KIT = path.join(PROOF_DIR, 'kit.mjs');

/**
 * A bundle's `run()` waits at most this: the slowest scenario takes tens of milliseconds, so one
 * that waits seconds is waiting for something that is not coming.
 */
const JOB_TIMEOUT_MS = 10_000;
/**
 * The whole realm run, which takes under a second here (about 0.8 s for the whole proof, bundling
 * included). A bundle that never returns, or loops, is killed at this many times that.
 */
const REALM_TIMEOUT_MS = 30_000;

const thirdPartyName = (file) =>
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/u.exec(file)?.[1];

const quote = (text) => JSON.stringify(text);

/** The bundles to build and run: every neutral subpath of every listed package, and every scenario. */
function planJobs({ packages, neutral, scenarioDir }) {
  const problems = [];
  const jobs = [];
  for (const [name, { short, entries }] of packages) {
    if (!neutral.includes(short)) continue;
    for (const [subpath, conditions] of entries) {
      if (isNodeOnly(conditions) || !pick(conditions, ['source'])) continue;
      const specifier = `${name}${subpath === '.' ? '' : subpath.slice(1)}`;
      jobs.push({
        id: `load ${specifier}`,
        kind: 'load',
        key: `load/${short}${subpath === '.' ? '' : `~${subpath.slice(2).replace(/\W+/gu, '-')}`}`,
        source: [
          `import ${quote(INSTALL)};`,
          `import * as entry from ${quote(specifier)};`,
          'export async function run() {',
          '  return JSON.stringify({ checks: [], exports: Object.keys(entry).length });',
          '}',
        ].join('\n'),
      });
    }
  }
  const scenarios = existsSync(scenarioDir)
    ? readdirSync(scenarioDir).filter((file) => file.endsWith('.scenario.mjs'))
    : [];
  for (const file of scenarios.sort()) {
    const short = file.slice(0, -'.scenario.mjs'.length);
    if (!neutral.includes(short)) {
      problems.push(
        `${file} is a scenario for ${short}, which ARCHITECTURE.md "Runtime platforms" does not list as Platform-neutral`,
      );
      continue;
    }
    jobs.push({
      id: `scenario ${short}`,
      kind: 'scenario',
      key: `scenario/${short}`,
      source: [
        `import ${quote(INSTALL)};`,
        `import scenario from ${quote(path.join(scenarioDir, file))};`,
        `import { runScenario } from ${quote(KIT)};`,
        'export const run = () => runScenario(scenario);',
      ].join('\n'),
    });
  }
  return { jobs, problems, scenarioPackages: scenarios.map((file) => file.split('.')[0]) };
}

/** esbuild plugin: virtual entries, workspace packages from `source`, Node built-ins as throwing stubs. */
function bundler({ root, packages, entries, reached }) {
  return {
    name: 'browser-runtime-proof',
    setup(builder) {
      builder.onResolve({ filter: /^proof-entry:/ }, (args) => ({
        path: args.path,
        namespace: 'proof-entry',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'proof-entry' }, (args) => ({
        contents: entries.get(args.path),
        loader: 'js',
        resolveDir: root,
      }));
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === 'unavailable' || !isBuiltin(args.path)) return undefined;
        reached.push({ importer: args.importer, specifier: args.path, kind: args.kind });
        return { path: args.path, namespace: 'unavailable' };
      });
      builder.onResolve({ filter: /^@robota-sdk\// }, (args) => {
        const match = /^(@robota-sdk\/[^/]+)(.*)$/u.exec(args.path);
        const target = match && packages.get(match[1]);
        if (!target) return undefined;
        const conditions = new Map(target.entries).get(match[2] ? `.${match[2]}` : '.');
        if (conditions === undefined) return { errors: [{ text: `${args.path} is not exported` }] };
        if (isNodeOnly(conditions)) {
          reached.push({ importer: args.importer, specifier: args.path, kind: 'node-only' });
          return { path: args.path, namespace: 'unavailable' };
        }
        const source = pick(conditions, ['source']);
        return source
          ? { path: path.join(target.dir, source) }
          : { errors: [{ text: `${args.path} has no source condition` }] };
      });
      builder.onLoad({ filter: /.*/, namespace: 'unavailable' }, (args) => ({
        contents: `throw new Error(${quote(`${args.path} is not available to a browser bundle`)});`,
        loader: 'js',
      }));
    },
  };
}

/** Runs the realm over the built bundles; resolves with one outcome per job that reported. */
function runRealm({ jobs, workDir, realmTimeoutMs, jobTimeoutMs }) {
  const jobsFile = path.join(workDir, 'jobs.json');
  writeFileSync(
    jobsFile,
    JSON.stringify({
      jobs: jobs.map(({ id, file }) => ({ id, file })),
      jobTimeoutMs,
    }),
  );
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-vm-modules', '--no-warnings', REALM, jobsFile],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), realmTimeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const lines = out
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      resolve({
        realm: lines.find((line) => line.realm)?.realm ?? [],
        outcomes: lines.filter((line) => line.id),
        ended:
          signal === 'SIGKILL'
            ? `was killed after ${realmTimeoutMs} ms`
            : code !== 0
              ? `exited ${code}: ${err.trim()}`
              : undefined,
      });
    });
  });
}

/** `packages/x/src/y.ts:12` for the top stack frame that lies in the bundle, through its source map. */
function sourceLocation({ stack, job, root }) {
  const bundleHref = pathToFileURL(job.file).href;
  const frame = new RegExp(
    `${bundleHref.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:(\\d+):(\\d+)`,
    'u',
  ).exec(stack ?? '');
  if (!frame) return undefined;
  try {
    const mapFile = `${job.file}.map`;
    const entry = new SourceMap(JSON.parse(readFileSync(mapFile, 'utf8'))).findEntry(
      Number(frame[1]) - 1,
      Number(frame[2]) - 1,
    );
    if (!entry?.originalSource) return undefined;
    const original = path.resolve(path.dirname(mapFile), entry.originalSource);
    const shown = path
      .relative(root, original)
      .replace(/^(?:.*\/)?node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?/u, '');
    return `${shown}:${entry.originalLine + 1}`;
  } catch {
    return undefined;
  }
}

/** What a thrown error says, with the global it names and where it was read. */
function failureText({ error, job, root }) {
  // A library wraps what went wrong; the cause is where the global was read.
  let origin = error;
  while (origin.cause !== undefined) origin = origin.cause;
  const missing = /^(\S+) is not defined$/u.exec(origin.message)?.[1];
  const where = sourceLocation({ stack: origin.stack, job, root });
  return `${
    missing && origin.name === 'ReferenceError'
      ? `read the global \`${missing}\`, which a browser does not define`
      : `${error.name}: ${error.message}${origin === error ? '' : ` (caused by ${origin.name}: ${origin.message})`}`
  }${where ? ` at ${where}` : ''}`;
}

/**
 * Every problem the dynamic check finds for the workspace at `workspaceRoot`; empty when the rule holds.
 * Also returns what ran, so a caller can report it.
 */
export async function runBrowserProof({
  root: workspaceRoot,
  scenarioDir = PROOF_DIR,
  outDir,
  jobTimeoutMs = JOB_TIMEOUT_MS,
  realmTimeoutMs = REALM_TIMEOUT_MS,
}) {
  const root = realpathSync(workspaceRoot);
  const packages = loadWorkspace(root);
  const lists = documentedPlatforms(readFileSync(path.join(root, 'ARCHITECTURE.md'), 'utf8'));
  const neutral = lists.get('Platform-neutral') ?? [];
  const plan = planJobs({ packages, neutral, scenarioDir });
  const problems = [...plan.problems];
  const result = { problems, jobs: [], loadOnly: [], realm: [] };
  mkdirSync(outDir ?? os.tmpdir(), { recursive: true });
  const workDir = realpathSync(outDir ?? mkdtempSync(path.join(os.tmpdir(), 'browser-proof-')));
  try {
    const jobs = plan.jobs.map((job) => ({
      ...job,
      file: path.join(workDir, `${job.key}.mjs`),
    }));
    const entries = new Map(jobs.map((job) => [`proof-entry:${job.key}`, job.source]));
    const reached = [];
    let built;
    try {
      built = await build({
        absWorkingDir: root,
        entryPoints: jobs.map((job) => ({ in: `proof-entry:${job.key}`, out: job.key })),
        outdir: workDir,
        outExtension: { '.js': '.mjs' },
        bundle: true,
        write: true,
        metafile: true,
        sourcemap: 'external',
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        jsx: 'automatic',
        loader: ASSET_LOADERS,
        plugins: [bundler({ root, packages, entries, reached })],
      });
    } catch (error) {
      for (const failure of error.errors ?? [{ text: String(error) }])
        problems.push(
          `the bundle does not build: ${failure.text}${failure.location ? ` (${failure.location.file}:${failure.location.line})` : ''}`,
        );
      return result;
    }

    // A Node built-in or Node-only subpath in a bundle: the job names are those whose bundle holds the importer.
    const relative = (file) => path.relative(root, path.resolve(root, file));
    const holders = (importer) =>
      jobs.filter((job) => {
        if (importer.startsWith('proof-entry:')) return importer === `proof-entry:${job.key}`;
        const output = built.metafile.outputs[path.relative(root, job.file)];
        return output && Object.keys(output.inputs).includes(relative(importer));
      });
    for (const { importer, specifier, kind } of reached) {
      const workspace = !thirdPartyName(importer);
      if (!workspace && kind === 'dynamic-import') continue;
      const names = holders(importer).map((job) => job.id);
      problems.push(
        `${kind === 'node-only' ? 'imports Node-only' : 'imports'} ${specifier}: ${workspace ? relative(importer) : importer.replace(/^.*node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?/u, '')} (in the bundle of ${names.length > 0 ? names.join(', ') : 'an entry'})`,
      );
    }

    const run = await runRealm({ jobs, workDir, realmTimeoutMs, jobTimeoutMs });
    result.realm = run.realm;
    const reported = new Set();
    for (const outcome of run.outcomes) {
      const job = jobs.find((candidate) => candidate.id === outcome.id);
      reported.add(job.id);
      const failures = [];
      if (outcome.leaked.length > 0)
        failures.push(`the realm defines ${outcome.leaked.join(', ')}: the proof is not isolated`);
      if (outcome.error) failures.push(failureText({ error: outcome.error, job, root }));
      if (outcome.result?.failure)
        failures.push(failureText({ error: outcome.result.failure, job, root }));
      for (const check of outcome.result?.checks ?? [])
        if (!check.ok && check.label !== 'the scenario ran to completion')
          failures.push(`"${check.label}" failed${check.detail ? `: ${check.detail}` : ''}`);
      for (const fault of outcome.faults)
        failures.push(`${fault.kind}: ${failureText({ error: fault, job, root })}`);
      for (const failure of failures) problems.push(`${job.id}: ${failure}`);
      result.jobs.push({
        id: job.id,
        kind: job.kind,
        ok: failures.length === 0,
        checks: outcome.result?.checks?.length ?? 0,
        exports: outcome.result?.exports,
        requests: outcome.result?.requests ?? 0,
        ms: outcome.ms,
        logs: outcome.logs,
      });
    }
    for (const job of jobs)
      if (!reported.has(job.id))
        problems.push(`${job.id}: no result; the realm ${run.ended ?? 'stopped before it ran'}`);
    result.loadOnly = [...neutral]
      .filter(
        (short) => packages.has(`@robota-sdk/${short}`) && !plan.scenarioPackages.includes(short),
      )
      .sort();
    return result;
  } finally {
    if (outDir === undefined) rmSync(workDir, { recursive: true, force: true });
  }
}

if (isEntryPoint(import.meta)) {
  const root = resolveWorkspaceRoot(import.meta);
  const outFlag = process.argv.indexOf('--out');
  const outDir = outFlag === -1 ? undefined : path.resolve(process.argv[outFlag + 1]);
  const started = Date.now();
  const result = await runBrowserProof({ root, outDir });
  const scenarios = result.jobs.filter((job) => job.kind === 'scenario');
  console.log(
    `browser runtime proof: ${result.jobs.length} bundles evaluated in a realm of web globals only (${REALM_GLOBAL_NAMES.join(', ')})`,
  );
  for (const job of result.jobs.filter((candidate) => candidate.kind === 'scenario'))
    console.log(
      `  ${job.ok ? 'ok  ' : 'FAIL'} ${job.id}: ${job.checks} checks, ${job.requests} requests, ${job.ms} ms`,
    );
  console.log(
    `  ${result.jobs.length - scenarios.length} entries loaded; no scenario yet for: ${result.loadOnly.join(', ') || 'none'}`,
  );
  if (result.problems.length === 0) {
    console.log(`  passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } else {
    for (const problem of result.problems) console.error(problem);
    console.error(
      `\n${result.problems.length} browser runtime problem(s). The rule is in ARCHITECTURE.md "Runtime platforms".`,
    );
    process.exitCode = 1;
  }
}
