import path from 'node:path';

import { isEntryPoint } from './entrypoint.mjs';

export const ROOT_MARKER = '::root::';
const ROOT_ENV = 'HARNESS_ROOT';

/**
 * The ONE workspace-root resolver every harness script uses (issue #2413).
 *
 * Convention: a scan reads the checkout it LIVES in — `<script dir>/../..` — unless an explicit
 * override names another root: `HARNESS_ROOT=<path>` in the environment or `--root <path>` /
 * `--root=<path>` on the command line. A fixture-driven script — one its tests spawn INSIDE a
 * scratch workspace — passes `{ fromCwd: true }` and reads the checkout it is RUN in instead;
 * that is the convention its callers already hold, and the override still wins over it.
 *
 * Six worktree reproductions once measured the MAIN checkout while standing in a worktree
 * (`cd <worktree> && node /main/scripts/harness/scan-….mjs`), each reported as "does not reproduce",
 * because every scan silently read the repository its file lived in and named no root. So when the
 * calling module IS the process entry and the root it resolved is NOT the directory the caller
 * stands in — or an override applied — the root is announced once on STDERR as a `::root:: <path>`
 * line (the `examined`-count precedent), and a run against the wrong repository names itself.
 * Stderr, because a script's stdout is its verdict or its payload (a scaffolded document, an
 * allocated ID) and every consumer of that stdout parses it. A run whose root IS its cwd has
 * nothing to disambiguate and stays silent. Library imports (tests, the runner) announce nothing.
 *
 * @param {ImportMeta} meta  the calling script's `import.meta`
 */
export function resolveWorkspaceRoot(
  meta,
  {
    env = process.env,
    argv = process.argv,
    cwd = process.cwd(),
    fromCwd = false,
    out = process.stderr,
  } = {},
) {
  const scriptDir = path.dirname(meta.filename);
  const isEntry = isEntryPoint(meta, argv);
  let override = null;
  for (let index = 2; isEntry && index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' && argv[index + 1]) override = argv[index + 1];
    else if (arg.startsWith('--root=')) override = arg.slice('--root='.length);
  }
  if (override === null && env[ROOT_ENV]) override = env[ROOT_ENV];
  const defaultRoot = fromCwd ? path.resolve(cwd) : path.resolve(scriptDir, '../..');
  const root = override === null ? defaultRoot : path.resolve(override);
  if (isEntry && (override !== null || root !== path.resolve(cwd))) {
    out.write(
      `${ROOT_MARKER} ${root}${override === null ? '' : ` (override: ${env[ROOT_ENV] && override === env[ROOT_ENV] ? ROOT_ENV : '--root'})`}\n`,
    );
  }
  return root;
}
export const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta, { fromCwd: true });
