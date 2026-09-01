import { WORK_RUN_PR_OBSERVATION_ENV } from './work-run-observation.mjs';

export function reportPrePushBaseResolution(
  { baseResolution, baseRef },
  write = process.stdout.write.bind(process.stdout),
) {
  if (baseResolution.source === 'fallback') {
    write(
      `▶ PR-base optimization unavailable: ${baseResolution.fallbackReason}; ` +
        `using fallback ${baseRef ?? 'unresolved'}\n`,
    );
    return;
  }
  write(`▶ pre-push base: ${baseRef} (${baseResolution.source})\n`);
}

function runMirroredScans(runtime, operations) {
  operations.write('\n▶ the required `scans` context, run locally (INFRA-069)\n');
  const mirror = operations.createMirror(runtime.changeClassification, {
    baseRef: runtime.basePlan.classificationBaseRef ?? null,
  });
  for (const [command, args] of mirror) {
    const started = operations.now();
    if (args[0] === 'harness:scan') {
      operations.run(command, args, {
        env: { [WORK_RUN_PR_OBSERVATION_ENV]: 'pre-push' },
      });
    } else {
      operations.run(command, args);
    }
    operations.write(
      `▶ ${args[0]} wall time: ${((operations.now() - started) / 1000).toFixed(1)}s\n`,
    );
  }
}

function runCliSmoke(classification, operations) {
  if (classification?.product === false) {
    operations.write(
      '\n▶ CLI smoke check skipped: no product code changed (harness/docs-only push)\n',
    );
    return;
  }
  operations.write('\n▶ CLI smoke check (cli:dev --version)\n');
  operations.run('pnpm', ['cli:dev', '--version']);
}

export function runPrePushVerification(runtime, input) {
  const operations = {
    now: Date.now,
    write: process.stdout.write.bind(process.stdout),
    ...input,
  };
  operations.write(`▶ scoped pre-push verification (${runtime.prePushMode})\n`);
  operations.write(
    runtime.baseRef
      ? `base: ${runtime.baseRef}\n`
      : 'base: unresolved; using working-tree changes only\n',
  );
  if (runtime.prePushMode === 'fast') {
    operations.write('dependent scope expansion: skipped; use HARNESS_PRE_PUSH_MODE=full\n');
  }
  operations.run('pnpm', [
    'harness:plan',
    '--',
    ...runtime.baseArgs,
    ...runtime.scopeExpansionArgs,
  ]);
  operations.run('pnpm', [
    'harness:verify',
    '--',
    ...runtime.baseArgs,
    ...runtime.scopeExpansionArgs,
    '--skip-record-check',
    '--skip-repository-check',
    'harness-tests',
  ]);
  runMirroredScans(runtime, operations);
  runCliSmoke(runtime.changeClassification, operations);
  operations.write('\nRelease-grade verification remains explicit:\n');
  operations.write('  HARNESS_PRE_PUSH_MODE=full pnpm harness:pre-push\n');
  operations.write('  pnpm harness:verify:release\n');
}
