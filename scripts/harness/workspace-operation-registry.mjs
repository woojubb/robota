/**
 * Single source of truth for package-wise execution capabilities and root script ownership.
 *
 * A missing workspace script is never silently treated as success. It must either use the
 * repository lint implementation or appear below with a non-empty, reviewable N/A reason.
 */

export const WORKSPACE_OPERATION_SCRIPTS = Object.freeze({
  build: 'build',
  'consumer-build': 'build',
  test: 'test',
  typecheck: 'typecheck',
  lint: 'lint',
  'examples-typecheck': 'typecheck',
});

// Static cross-package integration overrides are opt-in. The planner additionally discovers direct
// tested dependents with literal imports, so an empty override object does not disable propagation.
export const WORKSPACE_INTEGRATION_OWNERS = Object.freeze({});

// Typecheck is owner-local by default. Cross-package compiler contracts must be named here rather
// than inferred from reverse consumers, which otherwise turns ordinary checks into near-full runs.
export const WORKSPACE_TYPECHECK_INTEGRATION_OWNERS = Object.freeze({});

const CAPABILITY_NA = Object.freeze({
  build: Object.freeze({
    'examples/capabilities/agent-eval': 'Capability fixture is typecheck-only.',
    'examples/capabilities/decision-agent': 'Capability fixture is typecheck-only.',
    'examples/capabilities/multi-surface-deploy': 'Capability fixture is typecheck-only.',
    'examples/capabilities/openai-compatible-gateway': 'Capability fixture is typecheck-only.',
    'examples/capabilities/sandboxed-tools': 'Capability fixture is typecheck-only.',
    'examples/capabilities/stateless-turns': 'Capability fixture is typecheck-only.',
    'examples/capabilities/streaming': 'Capability fixture is typecheck-only.',
    scratch: 'Scratch is a source-ignored local development workspace.',
  }),
  test: Object.freeze({
    'apps/blog': 'Static content application has no owned unit-test suite.',
    'apps/docs': 'Documentation application has no owned unit-test suite.',
    'apps/starter-nextjs': 'Starter application is verified by build and typecheck.',
    'apps/www': 'Static website has no owned unit-test suite.',
    'examples/batch-processor': 'Example is verified by build and typecheck.',
    'examples/capabilities/agent-eval': 'Capability fixture is verified by typecheck.',
    'examples/capabilities/decision-agent': 'Capability fixture is verified by typecheck.',
    'examples/capabilities/multi-surface-deploy': 'Capability fixture is verified by typecheck.',
    'examples/capabilities/openai-compatible-gateway':
      'Capability fixture is verified by typecheck.',
    'examples/capabilities/sandboxed-tools': 'Capability fixture is verified by typecheck.',
    'examples/capabilities/stateless-turns': 'Capability fixture is verified by typecheck.',
    'examples/capabilities/streaming': 'Capability fixture is verified by typecheck.',
    'examples/cli': 'Example is verified by build and typecheck.',
    'examples/discord-bot': 'Example is verified by build and typecheck.',
    'examples/express': 'Example is verified by build and typecheck.',
    'examples/github-pr-reviewer': 'Example has no owned unit-test suite.',
    'examples/nextjs': 'Example is verified by build and typecheck.',
    'examples/slack-bot': 'Example has no owned unit-test suite.',
    'examples/telegram-bot': 'Example is verified by build and typecheck.',
    'examples/websocket-chat': 'Example is verified by build and typecheck.',
    'packages/agent-cli-web': 'Browser CLI package is verified by build and typecheck.',
    scratch: 'Scratch is a source-ignored local development workspace.',
  }),
  typecheck: Object.freeze({
    'examples/github-pr-reviewer': 'Example is outside the maintained TypeScript check surface.',
    'examples/slack-bot': 'Example is outside the maintained TypeScript check surface.',
    scratch: 'Scratch is a source-ignored local development workspace.',
  }),
  lint: Object.freeze({
    scratch: 'Scratch is a source-ignored local development workspace.',
  }),
});

export function resolveWorkspaceCapability(workspacePackage, operation) {
  const script = WORKSPACE_OPERATION_SCRIPTS[operation];
  if (!script) return { kind: 'unclassified', reason: `Unknown operation: ${operation}` };
  if (Object.hasOwn(workspacePackage.scripts ?? {}, script)) return { kind: 'script', script };

  const baseOperation =
    operation === 'consumer-build'
      ? 'build'
      : operation === 'examples-typecheck'
        ? 'typecheck'
        : operation;
  const reason = CAPABILITY_NA[baseOperation]?.[workspacePackage.directory];
  if (typeof reason === 'string' && reason.trim()) return { kind: 'not-applicable', reason };

  if (operation === 'lint' && /^(?:packages|apps|examples)\//u.test(workspacePackage.directory)) {
    return { kind: 'root-lint', script: 'lint', directory: workspacePackage.directory };
  }
  return {
    kind: 'unclassified',
    reason: `${workspacePackage.directory} has no ${script} script or explicit capability decision`,
  };
}

export const ROOT_SCRIPT_CLASSES = Object.freeze({
  'package-distributable': Object.freeze([
    'build:affected',
    'examples:typecheck:affected',
    'lint:affected',
    'test:affected',
    'typecheck:affected',
  ]),
  targeted: Object.freeze([
    'cli:dev',
    'docs:build',
    'docs:deploy',
    'docs:dev',
    'docs:preview',
    'test:coverage:apps',
    'test:coverage:packages',
    'web:build',
    'web:dev',
    'web:start',
  ]),
  aggregate: Object.freeze([
    'build',
    'build:all',
    'build:deps',
    'clean',
    'dev',
    'examples:typecheck',
    'harness:scan',
    'harness:test',
    'harness:verify',
    'harness:verify-like-ci',
    'harness:verify:release',
    'harness:workspace:affected',
    'harness:workspace:run',
    'lint',
    'lint:fix',
    'test',
    'test:coverage',
    'typecheck',
  ]),
  'global/control-plane': Object.freeze([
    'changeset',
    'clean:js',
    'deps:check',
    'docs:validate-structure',
    'git:push-tags',
    'harness:cleanup',
    'harness:conformance',
    'harness:lessons:digest',
    'harness:loop:close',
    'harness:loop:open',
    'harness:loop:report',
    'harness:loop:round',
    'harness:loop:show',
    'harness:plan',
    'harness:pre-push',
    'harness:record',
    'harness:release:check',
    'harness:release:init',
    'harness:release:report',
    'harness:release:triage',
    'harness:review',
    'harness:review-gate',
    'harness:review:record',
    'harness:run-context',
    'harness:scan:adr',
    'harness:scan:agent-server-boundary',
    'harness:scan:arch-map-completeness',
    'harness:scan:arch-map-paths',
    'harness:scan:background-workspace',
    'harness:scan:build-contracts',
    'harness:scan:capability-placement',
    'harness:scan:commands',
    'harness:scan:conflict-markers',
    'harness:scan:consistency',
    'harness:scan:coverage-scripts',
    'harness:scan:deprecated-markers',
    'harness:scan:deps',
    'harness:scan:design-doc',
    'harness:scan:dist',
    'harness:scan:document-authority',
    'harness:scan:document-standards',
    'harness:scan:done-evidence',
    'harness:scan:file-size',
    'harness:scan:functional-coverage',
    'harness:scan:hook-override-declarations',
    'harness:scan:legacy-typescript',
    'harness:scan:nested-package-glob-coverage',
    'harness:scan:orphan-exports',
    'harness:scan:public-project-authority',
    'harness:scan:publish',
    'harness:scan:reference-kind-qualified',
    'harness:scan:release-governance',
    'harness:scan:review-token-supply',
    'harness:scan:sdk-public-surface',
    'harness:scan:spec-doc-frontmatter',
    'harness:scan:spec-paths',
    'harness:scan:spec-public-surface',
    'harness:scan:specs',
    'harness:scan:stub-markers',
    'harness:scan:symlink-following-enumeration',
    'harness:scan:task-archival',
    'harness:scan:test-plans',
    'harness:scan:work-run',
    'harness:scan:workspace-refs',
    'harness:self-check',
    'harness:task:allocate',
    'harness:test:contracts',
    'harness:test:contracts:affected',
    'harness:test:hermetic',
    'harness:test:tiers:guard',
    'harness:work-run',
    'harness:work-run:attest',
    'harness:work-run:report',
    'lint:fix:staged',
    'pre-publish:check',
    'prepare',
    'proof:external',
    'publish:beta',
    'publish:packages',
    'readme:cleanup',
    'readme:copy',
    'readme:validate',
    'release',
    'test:mutation',
    'typecheck:compare',
    'version',
  ]),
});

export const WORKSPACE_OPERATION_ROOT_SCRIPTS = Object.freeze({
  build: Object.freeze({ full: 'build', affected: 'build:affected' }),
  'consumer-build': Object.freeze({ full: 'build', affected: null }),
  test: Object.freeze({ full: 'test', affected: 'test:affected' }),
  typecheck: Object.freeze({ full: 'typecheck', affected: 'typecheck:affected' }),
  lint: Object.freeze({ full: 'lint', affected: 'lint:affected' }),
  'examples-typecheck': Object.freeze({
    full: 'examples:typecheck',
    affected: 'examples:typecheck:affected',
  }),
});

const EXECUTABLE_ROOT_DESCRIPTORS = Object.freeze({
  build: { operation: 'build', execution: 'full', counterpart: 'build:affected' },
  'build:affected': { operation: 'build', execution: 'affected', counterpart: 'build' },
  test: { operation: 'test', execution: 'full', counterpart: 'test:affected' },
  'test:affected': { operation: 'test', execution: 'affected', counterpart: 'test' },
  typecheck: { operation: 'typecheck', execution: 'full', counterpart: 'typecheck:affected' },
  'typecheck:affected': { operation: 'typecheck', execution: 'affected', counterpart: 'typecheck' },
  lint: { operation: 'lint', execution: 'full', counterpart: 'lint:affected' },
  'lint:affected': { operation: 'lint', execution: 'affected', counterpart: 'lint' },
  'examples:typecheck': {
    operation: 'examples-typecheck',
    execution: 'full',
    counterpart: 'examples:typecheck:affected',
  },
  'examples:typecheck:affected': {
    operation: 'examples-typecheck',
    execution: 'affected',
    counterpart: 'examples:typecheck',
  },
  'harness:workspace:run': {
    operations: Object.keys(WORKSPACE_OPERATION_SCRIPTS),
    execution: 'generic-runner',
  },
});

export const ROOT_SCRIPT_DESCRIPTORS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROOT_SCRIPT_CLASSES).flatMap(([classification, names]) =>
      names.map((name) => [
        name,
        Object.freeze({ classification, ...(EXECUTABLE_ROOT_DESCRIPTORS[name] ?? {}) }),
      ]),
    ),
  ),
);

export function rootScriptForOperation(operation, execution = 'full') {
  const script = WORKSPACE_OPERATION_ROOT_SCRIPTS[operation]?.[execution];
  if (!script) return null;
  const descriptor = ROOT_SCRIPT_DESCRIPTORS[script];
  if (
    !descriptor ||
    descriptor.operation !== (operation === 'consumer-build' ? 'build' : operation) ||
    descriptor.execution !== execution
  ) {
    throw new Error(`Root script descriptor mismatch for ${operation}:${execution}`);
  }
  return script;
}

export function classifyRootScript(scriptName) {
  const matches = Object.entries(ROOT_SCRIPT_CLASSES)
    .filter(([, names]) => names.includes(scriptName))
    .map(([classification]) => classification);
  return { scriptName, matches, classification: matches.length === 1 ? matches[0] : null };
}
