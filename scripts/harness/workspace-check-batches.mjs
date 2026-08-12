const BATCHED_CHECKS = ['test', 'lint', 'typecheck'];

export function createWorkspaceCheckBatches({ planScopes, scopes, concurrency = 4 }) {
  const scopeByPath = new Map(scopes.map((scope) => [scope.relativeDir, scope]));
  const batches = [];

  for (const check of BATCHED_CHECKS) {
    const selected = planScopes
      .filter((planScope) => planScope.checks.includes(check))
      .map((planScope) => scopeByPath.get(planScope.scope))
      .filter((scope) => scope && Object.hasOwn(scope.scripts ?? {}, check));
    if (selected.length === 0) continue;

    batches.push({
      check,
      scopeNames: selected.map((scope) => scope.relativeDir),
      args: [
        ...selected.flatMap((scope) => ['--filter', scope.workspaceName]),
        `--workspace-concurrency=${concurrency}`,
        '--aggregate-output',
        '--no-bail',
        '--fail-if-no-match',
        '-r',
        check,
      ],
    });
  }

  return batches;
}

export function executeWorkspaceCheckBatches(batches, runner) {
  const evidence = [];
  const failures = [];

  for (const batch of batches) {
    const result = runner(batch);
    if (!result || typeof result.status !== 'number') {
      throw new Error(`Missing batch result evidence for ${batch.check}`);
    }
    const status = result.status === 0 ? 'pass' : 'fail';
    for (const scope of batch.scopeNames) evidence.push({ scope, check: batch.check, status });
    if (status === 'fail') failures.push({ check: batch.check, scopes: [...batch.scopeNames] });
  }

  return { evidence, failures };
}
