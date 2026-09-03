import { CI_STAGES, describeCiSource, MIRRORED_BRANCH, NOT_MIRRORED } from './ci-mirror-map.mjs';
import { classifyFiles } from './classify-changed-paths.mjs';

const DEFAULT_BASE_REF = 'origin/develop';

function formatDuration(durationMs) {
  const seconds = Math.max(0, durationMs) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

/**
 * The stages whose typecheck resolves cross-package types through built `dist/`. A stale dist —
 * one older than its package's `src/` — makes those stages report a type error in a package the
 * branch never touched, and it reads as "develop is broken" (issue #2200).
 */
const DIST_TYPED_STAGES = new Set(['package-quality', 'examples-typecheck']);

export function readsDistTypes(stageName) {
  return DIST_TYPED_STAGES.has(stageName);
}

/**
 * The diagnosis, placed where the reader is looking (issue #2200). The `dist` scan already measures
 * staleness and prints an advisory among ~140 scan results, at a different moment than the failure
 * it explains; three cross-package type errors in one session were each mis-read as a branch defect
 * before anyone connected the two. `null` when nothing is stale, so the line stays a signal rather
 * than boilerplate.
 */
export function staleDistHint(staleScopes) {
  if (!Array.isArray(staleScopes) || staleScopes.length === 0) return null;
  return (
    `stale dist: ${staleScopes.join(', ')} — dist/ is older than src/, so this typecheck may be ` +
    'reading old cross-package types; run `pnpm build` and re-check before treating it as a branch defect'
  );
}

export function summarize(
  results,
  { skippedStages = [], notMirrored = [], totalDurationMs = null } = {},
) {
  const lines = ['', 'verify-like-ci summary:'];
  for (const result of results) {
    const mark = result.status === 'pass' ? '✓' : result.status === 'skip' ? '-' : '✗';
    const timing =
      typeof result.durationMs === 'number' ? ` [${formatDuration(result.durationMs)}]` : '';
    lines.push(`${mark} ${result.name}${timing}${result.note ? ` — ${result.note}` : ''}`);
  }
  if (typeof totalDurationMs === 'number')
    lines.push(`total elapsed: ${formatDuration(totalDurationMs)}`);
  for (const entry of notMirrored) {
    const mark = entry.relevant ? '!' : '·';
    lines.push(`${mark} ${entry.context} — NOT mirrored locally: ${entry.reason}`);
    if (entry.relevant) {
      lines.push(
        `    this diff makes it relevant (${entry.relevantWhen}). Run it yourself: ${entry.manualCommand}`,
      );
    }
  }
  const failed = results.filter((result) => result.status === 'fail');
  if (failed.length > 0) {
    lines.push(
      `FAIL — ${failed.length} of ${results.length} stage(s) failed: ${failed
        .map((result) => result.name)
        .join(', ')}`,
    );
    for (const result of failed) {
      const stage = CI_STAGES.find((entry) => entry.name === result.name);
      if (stage) lines.push(`  ${result.name} covers ${describeCiSource(stage)}`);
    }
    return { lines, exitCode: 1 };
  }
  if (skippedStages.length > 0) {
    lines.push(
      `PARTIAL — ${results.length} selected stage(s) passed. This is NOT a CI-equivalent result: ` +
        `${skippedStages.length} stage(s) were not run (${skippedStages.join(', ')}). ` +
        'Run `pnpm harness:verify-like-ci` with no --only before claiming the gate is green.',
    );
    return { lines, exitCode: 0 };
  }
  lines.push(
    `PASS — all ${results.length} stage(s) passed; mirrors the required checks of \`${MIRRORED_BRANCH}\`.`,
  );
  return { lines, exitCode: 0 };
}

export function parseArgs(argv) {
  const only = new Set();
  let baseRef = DEFAULT_BASE_REF;
  let allFiles = false;
  let full = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--only' && argv[index + 1]) only.add(argv[++index]);
    else if (argv[index] === '--base-ref' && argv[index + 1]) baseRef = argv[++index];
    else if (argv[index] === '--all-files') allFiles = true;
    else if (argv[index] === '--full') full = true;
  }
  const unknown = [...only].filter((name) => !CI_STAGES.some((stage) => stage.name === name));
  return { only, baseRef, allFiles, full, unknown };
}

export function annotateNotMirrored(
  changedFiles,
  productChanged = classifyFiles(changedFiles).product,
) {
  const touchesManifest = changedFiles.some(
    (file) =>
      file === 'pnpm-lock.yaml' || file === 'package.json' || file.endsWith('/package.json'),
  );
  const relevant = (key) => {
    if (key === 'manifest-or-lockfile') return touchesManifest;
    if (key === 'code') return productChanged;
    if (key === 'guarded-workflow') {
      return changedFiles.some((file) => file.startsWith('.github/workflows/'));
    }
    if (key === 'every-pull-request') return true;
    return true;
  };
  return NOT_MIRRORED.map((entry) => ({ ...entry, relevant: relevant(entry.relevance) }));
}
