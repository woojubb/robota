/**
 * Runs proof bundles, each in its own `vm` context whose only globals are the language's own and
 * those of `web-globals.mjs`. Started by `browser-runtime-proof.mjs` as a child process, because
 * ES modules in a `vm` context need `--experimental-vm-modules` and because a bundle that never
 * returns must be killable.
 *
 *   node --experimental-vm-modules realm.mjs <jobs.json>
 *
 * Writes one JSON line per job to stdout, as the job finishes. The code under proof is the whole
 * bundle: nothing is imported from the host, and a name outside the realm's globals is a
 * `ReferenceError` there exactly as it is in a page.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { NODE_ONLY_GLOBAL_NAMES, createRealmGlobals } from './web-globals.mjs';

const { jobs, jobTimeoutMs } = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const describe = (error, depth = 0) => ({
  name: String(error?.name ?? typeof error),
  message: String(error?.message ?? error),
  stack: typeof error?.stack === 'string' ? error.stack : undefined,
  ...(depth < 4 && error?.cause !== undefined ? { cause: describe(error.cause, depth + 1) } : {}),
});

/** Faults raised outside any promise the scenario awaited: a timer callback that threw, a rejection nobody handled. */
let faults = [];
process.on('uncaughtException', (error) =>
  faults.push({ kind: 'uncaught exception', ...describe(error) }),
);
process.on('unhandledRejection', (error) =>
  faults.push({ kind: 'unhandled rejection', ...describe(error) }),
);

const emit = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runJob({ id, file }) {
  const realm = createRealmGlobals();
  const context = vm.createContext(realm.sandbox);
  const present = vm.runInContext('Object.getOwnPropertyNames(globalThis)', context);
  const outcome = {
    id,
    leaked: NODE_ONLY_GLOBAL_NAMES.filter((name) => present.includes(name)),
  };
  faults = [];
  const started = performance.now();
  try {
    const href = pathToFileURL(file).href;
    const bundle = new vm.SourceTextModule(readFileSync(file, 'utf8'), {
      context,
      identifier: href,
      initializeImportMeta(meta) {
        meta.url = href;
      },
    });
    await bundle.link((specifier) => {
      throw new Error(`the bundle still imports "${specifier}"`);
    });
    await bundle.evaluate({ timeout: jobTimeoutMs });
    outcome.result = JSON.parse(await withTimeout(bundle.namespace.run(), jobTimeoutMs, 'run()'));
  } catch (error) {
    outcome.error = describe(error);
  }
  // Let a rejection nobody handled surface before the verdict.
  await new Promise((resolve) => setImmediate(resolve));
  realm.dispose();
  outcome.faults = faults;
  outcome.logs = realm.logs;
  outcome.ms = Math.round(performance.now() - started);
  emit(outcome);
}

emit({
  realm: vm.runInContext(
    'Object.getOwnPropertyNames(globalThis)',
    vm.createContext(createRealmGlobals().sandbox),
  ),
});
for (const job of jobs) await runJob(job);
process.stdout.write('', () => process.exit(0));
