import { spawnSync } from 'node:child_process';

import { CI_STAGES, describeCiSource, MIRRORED_BRANCH, NOT_MIRRORED } from './ci-mirror-map.mjs';
import { staleDistScopes } from './scan-dist-freshness.mjs';
import { appendJobSummary } from './shared.mjs';
import { realDirtyLines, shouldWriteFullReceipt } from './verification-receipt.mjs';
import { runDistFreeScanSuite, runScanSuite } from './verify-like-ci-dist-free.mjs';
import { runFormatCheck } from './verify-like-ci-format.mjs';
import {
  advanceBuildState,
  blockedStageResult,
  describeAffectedScopes,
  initialBuildState,
  preflight,
  resolveRunContext,
  runProductStage,
  stageGate,
} from './verify-like-ci-product.mjs';
import {
  annotateNotMirrored,
  parseArgs,
  readsDistTypes,
  staleDistHint,
  summarize,
} from './verify-like-ci-reporting.mjs';
import { WORKSPACE_ROOT, gitOrThrow, parseGitFileList, run } from './verify-like-ci-shared.mjs';

export function firstParentCommits(baseRef) {
  return parseGitFileList(gitOrThrow(['rev-list', '--first-parent', `${baseRef}..HEAD`]));
}

async function runCommitlint({ baseRef }) {
  const commits = firstParentCommits(baseRef);
  if (commits.length === 0) return { code: 0, note: `no commits authored vs ${baseRef}` };
  for (const sha of commits) {
    const message = spawnSync('git', ['log', '-1', '--format=%B', sha], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });
    const lint = spawnSync('pnpm', ['exec', 'commitlint', '--verbose'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      input: message.stdout ?? '',
    });
    if (lint.status !== 0) {
      process.stderr.write(
        `\n[commitlint] ${sha.slice(0, 9)} ${(message.stdout ?? '').split('\n')[0]}\n` +
          `${lint.stdout ?? ''}${lint.stderr ?? ''}\n`,
      );
      return { code: 1, note: `${sha.slice(0, 9)} fails the conventional-commit rules` };
    }
  }
  return { code: 0, note: `${commits.length} commit(s) vs ${baseRef}` };
}

async function runBuild(options, context) {
  const outcome = await runProductStage('build', options, context);
  return { ...outcome, note: context.buildReason };
}

async function runPackageQuality(options, context) {
  const outcome = await runProductStage('package-quality', options, context, { concurrent: true });
  return { ...outcome, note: describeAffectedScopes(context) };
}

async function runAffectedContractTests({ baseRef }) {
  const code = await run('pnpm', [
    'harness:test:contracts:affected',
    '--',
    '--base-ref',
    baseRef,
    '--head-ref',
    'HEAD',
  ]);
  return { code };
}

export const STAGE_RUNNERS = {
  'format-check': runFormatCheck,
  commitlint: runCommitlint,
  'harness-self-test': runAffectedContractTests,
  'harness-hermetic-test': async () => ({ code: await run('pnpm', ['harness:test:hermetic']) }),
  'scan-suite-dist-free': runDistFreeScanSuite,
  build: runBuild,
  'scan-suite': runScanSuite,
  'package-quality': runPackageQuality,
  'binary-e2e': async () => ({
    code: await run('pnpm', ['--filter', '@robota-sdk/agent-cli', 'test:bin']),
  }),
  'examples-typecheck': (options, context) =>
    runProductStage('examples-typecheck', options, context),
  'tui-e2e': async () => ({
    code: await run('pnpm', ['--filter', '@robota-sdk/agent-transport-tui', 'test:pty']),
  }),
};

async function resolveContextOrReport(options) {
  try {
    return await resolveRunContext(options.baseRef, { forceFull: options.full });
  } catch (error) {
    process.stderr.write(
      `\nverify-like-ci could not resolve what this branch changes: ${error?.message ?? error}\n` +
        `Every stage gate is derived from that, so running a subset would report a pass over ground\n` +
        `it never measured. Fix the base ref (\`--base-ref <ref>\`, or fetch the base branch) and re-run.\n`,
    );
    return null;
  }
}

/**
 * A failed typecheck beside a stale dist/ names the stale packages and the rebuild command in the
 * stage's OWN failure output — where the reader is looking — instead of an advisory printed among
 * the scan results an earlier stage produced (issue #2200). Measured only on a failure of a stage
 * that reads dist types, so a passing run pays nothing and a fresh tree adds no line. A failed
 * measurement is reported, not swallowed: the stage verdict stands either way.
 */
async function annotateStaleDist(stageName, outcome) {
  if (outcome.code === 0 || !readsDistTypes(stageName)) return outcome.note;
  let hint;
  try {
    hint = staleDistHint(await staleDistScopes(WORKSPACE_ROOT));
  } catch (error) {
    process.stderr.write(
      `${stageName}: dist freshness could not be measured: ${error?.message ?? error}\n`,
    );
    return outcome.note;
  }
  if (hint === null) return outcome.note;
  process.stderr.write(`${stageName}: ${hint}\n`);
  return outcome.note ? `${outcome.note}; ${hint}` : hint;
}

async function executeStages(selected, options, context) {
  const results = [];
  let buildState = initialBuildState(selected, context);
  const runStartedAt = performance.now();
  for (const stage of selected) {
    const stageStartedAt = performance.now();
    const gate = stageGate(stage.name, context);
    if (!gate.run) {
      process.stdout.write(`\n===== ${stage.name} (skipped) =====\n${gate.note}\n`);
      results.push({
        name: stage.name,
        status: 'skip',
        note: gate.note,
        durationMs: performance.now() - stageStartedAt,
      });
      continue;
    }
    process.stdout.write(`\n===== ${stage.name} =====\n`);
    const blocked = blockedStageResult(stage, buildState);
    if (blocked) {
      results.push({ ...blocked, durationMs: performance.now() - stageStartedAt });
      continue;
    }
    process.stdout.write(`mirrors: ${describeCiSource(stage)}\n`);
    const outcome = await STAGE_RUNNERS[stage.name](options, context);
    results.push({
      name: stage.name,
      status: outcome.code === 0 ? 'pass' : 'fail',
      note: await annotateStaleDist(stage.name, outcome),
      durationMs: performance.now() - stageStartedAt,
    });
    buildState = advanceBuildState(buildState, stage, outcome.code);
  }
  return { results, totalDurationMs: performance.now() - runStartedAt };
}

async function writeReceiptIfEligible({ exitCode, selected, options }) {
  let clean = false;
  let dirty = [];
  try {
    dirty = realDirtyLines(WORKSPACE_ROOT);
    clean = dirty.length === 0;
  } catch (error) {
    process.stderr.write(`verification receipt eligibility failed: ${error?.message ?? error}\n`);
  }
  if (
    shouldWriteFullReceipt({
      exitCode,
      clean,
      selectedStages: selected.map((stage) => stage.name),
      requiredStages: CI_STAGES.map((stage) => stage.name),
    })
  ) {
    return run('scripts/harness/with-repo-lock.sh', [
      process.execPath,
      'scripts/harness/verification-receipt.mjs',
      '--base-ref',
      options.baseRef,
      ...selected.flatMap((stage) => ['--stage', stage.name]),
    ]);
  }
  if (exitCode === 0) {
    const missing = CI_STAGES.map((stage) => stage.name).filter(
      (name) => !selected.some((stage) => stage.name === name),
    );
    const reasons = [];
    if (missing.length > 0)
      reasons.push(`partial run — stage(s) not selected: ${missing.join(', ')}`);
    if (!clean) reasons.push(`working tree is not clean: ${dirty.join(', ')}`);
    process.stdout.write(
      `verification receipt not written: ${reasons.join('; ') || 'eligibility check failed'}\n` +
        '  (without a receipt the next `git push` re-runs this entire gate)\n',
    );
  }
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.unknown.length > 0) {
    process.stderr.write(`unknown --only stage(s): ${options.unknown.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const selected = CI_STAGES.filter(
    (stage) => options.only.size === 0 || options.only.has(stage.name),
  );
  const prerequisites = preflight();
  if (!prerequisites.ok) {
    process.stderr.write(prerequisites.message);
    process.exitCode = 1;
    return;
  }
  const context = await resolveContextOrReport(options);
  if (!context) {
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `\nmirroring the required checks of \`${MIRRORED_BRANCH}\` — ${context.changedFiles.length} changed file(s) vs ${options.baseRef}, ` +
      `${context.codeChanged ? 'CODE' : 'docs-only'}, ${context.distRequired ? 'build output required' : 'no build output required'}\n`,
  );
  const { results, totalDurationMs } = await executeStages(selected, options, context);
  const skippedStages = CI_STAGES.filter((stage) => !selected.includes(stage)).map(
    (stage) => stage.name,
  );
  const summary = summarize(results, {
    skippedStages,
    notMirrored: annotateNotMirrored(context.changedFiles, context.productChanged),
    totalDurationMs,
  });
  process.stdout.write(`${summary.lines.join('\n')}\n`);
  appendJobSummary(`${summary.lines.join('\n')}\n`);
  const receiptCode = await writeReceiptIfEligible({
    exitCode: summary.exitCode,
    selected,
    options,
  });
  process.exitCode = summary.exitCode === 0 && receiptCode === 0 ? 0 : 1;
}

export { CI_STAGES, NOT_MIRRORED };
