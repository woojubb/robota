import { canonicalTemporaryDirectory } from './canonical-temporary-directory.mjs';
import { runCommand, WORKSPACE_ROOT } from './shared.mjs';

const REPOSITORY_CHECK_NAMES = new Set([
  'task-plan-scan',
  'harness-consistency',
  'publish-safety',
  'harness-tests',
  'repository-review',
]);

const ROOT_OPERATIONS = [
  {
    check: 'build',
    skipOption: 'skipBuild',
    fullScript: 'build',
    affectedScript: 'build:affected',
  },
  { check: 'test', skipOption: 'skipTests', fullScript: 'test', affectedScript: 'test:affected' },
  { check: 'lint', skipOption: 'skipLint', fullScript: 'lint', affectedScript: 'lint:affected' },
  {
    check: 'typecheck',
    skipOption: 'skipTypecheck',
    fullScript: 'typecheck',
    affectedScript: 'typecheck:affected',
  },
];

export function selectRepositoryChecks(repositoryChecks, omittedNames) {
  for (const name of omittedNames) {
    if (!REPOSITORY_CHECK_NAMES.has(name)) {
      throw new Error(`Unknown repository check omission: ${name}`);
    }
  }
  const omitted = new Set(omittedNames);
  return repositoryChecks.filter((check) => !omitted.has(check));
}

export function repositoryCheckEnvironment(check) {
  return check === 'harness-tests' ? { TMPDIR: canonicalTemporaryDirectory() } : {};
}

export function shouldUseFullRootVerification(plan, options, environment = process.env) {
  const explicitlyFull =
    environment.HARNESS_VERIFY_MODE === 'full' || environment.RELEASE_VERIFICATION === '1';
  const workspaceWide = (plan.workspaceWideTriggers?.length ?? 0) > 0;
  const inferredFullWorkspace =
    options.scopeTokens.length === 0 &&
    plan.workspaceScopeCount > 0 &&
    plan.scopes.length === plan.workspaceScopeCount;
  return explicitlyFull || workspaceWide || inferredFullWorkspace;
}

export function createRootVerificationCommands({ plan, options, environment = process.env }) {
  const full = shouldUseFullRootVerification(plan, options, environment);
  const affectedArgs = [];
  if (options.baseRef) affectedArgs.push('--base-ref', options.baseRef);
  for (const scope of options.scopeTokens) affectedArgs.push('--scope', scope);
  return ROOT_OPERATIONS.filter(({ check, skipOption }) => {
    if (options[skipOption]) return false;
    return plan.scopes.some((scope) => scope.checks.includes(check));
  }).map(({ check, fullScript, affectedScript }) => ({
    check,
    mode: full ? 'full' : 'affected',
    command: 'pnpm',
    args: full
      ? [fullScript]
      : [affectedScript, ...(affectedArgs.length ? ['--', ...affectedArgs] : [])],
  }));
}

export function runRepositoryCheck(check, dryRun) {
  const scripts = {
    'task-plan-scan': 'harness:scan:test-plans',
    'harness-consistency': 'harness:scan:consistency',
    'publish-safety': 'harness:scan:publish',
  };
  if (scripts[check]) return runCommand('pnpm', [scripts[check]], WORKSPACE_ROOT, dryRun);
  if (check === 'repository-review') {
    process.stdout.write('note: repository-review has no executable fast-path check.\n');
    return;
  }
  if (check !== 'harness-tests') throw new Error(`Unknown repository check: ${check}`);
  runCommand(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      'scripts/harness/__tests__',
      '--pool=threads',
      '--maxWorkers=2',
      '--testTimeout=30000',
      '--reporter=dot',
    ],
    WORKSPACE_ROOT,
    dryRun,
    repositoryCheckEnvironment(check),
  );
}
