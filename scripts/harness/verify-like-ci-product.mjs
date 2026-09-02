import { createVerificationPlan, planRequiresPackageDist } from './check-plan.mjs';
import { classifyFiles, resolveCapabilityReachability } from './classify-changed-paths.mjs';
import {
  collectPackageManifestChanges,
  collectRootManifestChange,
  detectChangedFiles,
  listWorkspaceScopes,
} from './shared.mjs';
import {
  checkTreePrerequisites,
  formatPrerequisiteFailure,
  inspectTree,
} from './tree-prerequisites.mjs';
import { findMissingDist, listBuildablePackageDirs } from './verify-like-ci-dist-free.mjs';
import { WORKSPACE_ROOT, run } from './verify-like-ci-shared.mjs';

function affectedScriptArgs(script, baseRef) {
  return [script, '--', '--base-ref', baseRef];
}

export function createProductStageCommands(stageName, { baseRef }, context) {
  const full = context.fullProductVerification === true;
  switch (stageName) {
    case 'build':
      return full
        ? [['pnpm', ['build']]]
        : [['pnpm', affectedScriptArgs('build:affected', baseRef)]];
    case 'package-quality':
      if (full) return ['test', 'typecheck', 'lint'].map((operation) => ['pnpm', [operation]]);
      return [
        ...['test', 'typecheck', 'lint'].map((operation) => [
          'pnpm',
          affectedScriptArgs(`${operation}:affected`, baseRef),
        ]),
        [
          'pnpm',
          [
            'exec',
            'eslint',
            'packages',
            'apps',
            '--ext',
            '.ts,.tsx',
            '--cache',
            '--cache-location',
            '.cache/eslint/verify-like-ci.cache',
            '--cache-strategy',
            'content',
            '--max-warnings',
            '2203',
          ],
        ],
      ];
    case 'examples-typecheck':
      return [
        [
          'pnpm',
          full
            ? ['examples:typecheck']
            : affectedScriptArgs('examples:typecheck:affected', baseRef),
        ],
      ];
    default:
      throw new Error(`No full/affected product command mapping for stage: ${stageName}`);
  }
}

export async function runProductStage(stageName, options, context, { concurrent = false } = {}) {
  const commands = createProductStageCommands(stageName, options, context);
  if (concurrent) {
    const codes = await Promise.all(commands.map(([command, args]) => run(command, args)));
    return { code: codes.some((code) => code !== 0) ? 1 : 0 };
  }
  for (const [command, args] of commands) {
    const code = await run(command, args);
    if (code !== 0) return { code };
  }
  return { code: 0 };
}

export function describeAffectedScopes(context) {
  const scopes = (context?.plan?.scopes ?? []).map((scope) => scope.scope);
  return scopes.length === 0
    ? 'no package/app scope affected — CI verifies none either'
    : `${scopes.length} affected scope(s): ${scopes.slice(0, 4).join(', ')}${scopes.length > 4 ? ' …' : ''}`;
}

export function classifyLocalProductChanges(
  changedFiles,
  { rootManifestChange = null, cwd = WORKSPACE_ROOT, forceFull = false } = {},
) {
  const capabilities = resolveCapabilityReachability(changedFiles, { cwd });
  const classification = classifyFiles(changedFiles, { rootManifestChange, capabilities });
  const productChanged = forceFull || classification.product;
  const fullProductVerification = forceFull || (classification.full && classification.product);
  const capabilityApplies = (name) =>
    productChanged &&
    (fullProductVerification || capabilities.error !== undefined || capabilities[name] === true);
  return {
    classification,
    capabilities,
    productChanged,
    fullProductVerification,
    tuiChanged: capabilityApplies('tui'),
    examplesChanged: capabilityApplies('examples'),
    windowsChanged: capabilityApplies('windows'),
    cliChanged: capabilityApplies('cli'),
  };
}

function describeBuildReason({ distRequired, productChanged, fullProductVerification }) {
  if (fullProductVerification) return 'product-wide root or workspace graph change: full build';
  if (distRequired) return 'the affected plan needs build output';
  if (productChanged) return 'affected product capability requires build output';
  return 'skipped';
}

export async function resolveRunContext(baseRef, { forceFull = false } = {}) {
  const changedFiles = detectChangedFiles(baseRef);
  const scopes = await listWorkspaceScopes();
  const manifestChangesByScope = await collectPackageManifestChanges({
    scopes,
    changedFiles,
    baseRef,
  });
  const rootManifestChange = await collectRootManifestChange({ changedFiles, baseRef });
  const plan = createVerificationPlan({
    scopes,
    changedFiles,
    scopeTokens: [],
    manifestChangesByScope,
    rootManifestChange,
    includeDependentScopes: true,
  });
  const missingDist = findMissingDist(listBuildablePackageDirs());
  const distRequired = planRequiresPackageDist(plan);
  const local = classifyLocalProductChanges(changedFiles, { rootManifestChange, forceFull });
  return {
    changedFiles,
    plan,
    distRequired,
    codeChanged: local.classification.code,
    productChanged: local.productChanged,
    fullProductVerification: local.fullProductVerification,
    tuiChanged: local.tuiChanged,
    examplesChanged: local.examplesChanged,
    windowsChanged: local.windowsChanged,
    cliChanged: local.cliChanged,
    harnessChanged: local.classification.harness,
    missingDist,
    buildReason: describeBuildReason({
      distRequired,
      productChanged: local.productChanged,
      fullProductVerification: local.fullProductVerification,
    }),
  };
}

export function preflight(root = WORKSPACE_ROOT) {
  return checkTreePrerequisites('verify-like-ci', root, ['install']);
}

function readMissingDistNow() {
  return findMissingDist(listBuildablePackageDirs());
}

export function initialBuildState(selected, context) {
  const buildRuns =
    selected.some((stage) => stage.name === 'build') && stageGate('build', context).run;
  return {
    buildPending: buildRuns,
    buildFailed: false,
    missingDist: context.missingDist,
    fullProductVerification: context.fullProductVerification === true,
  };
}

export function advanceBuildState(state, stage, code, readMissingDist = readMissingDistNow) {
  if (stage.name !== 'build') return state;
  const missingDist =
    code === 0 && state.fullProductVerification === false ? [] : readMissingDist();
  return { ...state, buildPending: false, buildFailed: code !== 0, missingDist };
}

export function stageBlockCause(stage, state) {
  if (!stage?.needsBuildOutput) return null;
  if (state.buildPending || state.missingDist.length === 0) return null;
  return state.buildFailed ? 'build-failed' : 'unprepared';
}

export function stageGate(name, context) {
  switch (name) {
    case 'harness-hermetic-test':
      return context.harnessChanged !== false
        ? { run: true }
        : {
            run: false,
            note: 'harness capability is not affected — CI skips only the hermetic tier',
          };
    case 'build':
      return context.productChanged
        ? { run: true }
        : { run: false, note: 'product capability is not affected — CI reports product build N/A' };
    case 'binary-e2e':
      return context.cliChanged
        ? { run: true }
        : { run: false, note: 'CLI capability is not affected — CI reports binary e2e N/A' };
    case 'package-quality':
    case 'scan-suite':
      return context.productChanged
        ? { run: true }
        : { run: false, note: 'product capability is not affected — CI reports quality N/A' };
    case 'examples-typecheck':
      return context.examplesChanged
        ? { run: true }
        : { run: false, note: 'examples capability is not affected — CI reports N/A' };
    case 'tui-e2e':
      return context.tuiChanged
        ? { run: true }
        : { run: false, note: 'TUI capability is not affected — CI reports N/A' };
    default:
      return { run: true };
  }
}

export function blockedStageResult(stage, buildState) {
  const blocked = stageBlockCause(stage, buildState);
  if (!blocked) return null;
  process.stderr.write(
    formatPrerequisiteFailure(
      `verify-like-ci stage \`${stage.name}\``,
      inspectTree(WORKSPACE_ROOT, ['build-output']),
      blocked,
    ),
  );
  return {
    name: stage.name,
    status: 'fail',
    note:
      blocked === 'build-failed'
        ? '`build` failed in this run — this stage measured nothing'
        : 'unbuilt tree — this stage measured nothing; run `pnpm build`',
  };
}
