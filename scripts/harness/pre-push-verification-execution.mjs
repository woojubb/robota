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

export function runPrePushVerification(runtime, input) {
  const operations = {
    write: process.stdout.write.bind(process.stdout),
    ...input,
  };
  operations.write(`▶ local pre-push checks (planning mode: ${runtime.prePushMode})\n`);
  operations.write(
    runtime.baseRef
      ? `base: ${runtime.baseRef}\n`
      : 'base: unresolved; using working-tree changes only\n',
  );
  if (runtime.prePushMode === 'fast') {
    operations.write('planning dependent scope expansion: skipped\n');
  }
  operations.run('pnpm', [
    'harness:plan',
    '--',
    ...runtime.baseArgs,
    ...runtime.scopeExpansionArgs,
  ]);
  operations.write('\nLocal checks reused from commit hooks: formatting and commit messages\n');
  operations.write('Pre-push ran only changed-input planning; it did not repeat completed local checks.\n');
  operations.write('CI-owned (not run locally): repository-contract, hermetic, pristine\n');
  operations.write(
    'Manual (not run by pre-push): focused changed-code tests and affected product diagnostics\n',
  );
  operations.write('Merge still requires checking the current remote CI results.\n');
}
