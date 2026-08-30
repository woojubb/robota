import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  WORKSPACE_WIDE_BUILD_TOOLING_PATHS,
  createVerificationPlan,
  listWorkspaceWideTriggers,
  parsePlanArgs,
  renderPlanSummary,
  renderScopeCoverageLine,
} from '../check-plan.mjs';
import { appendJobSummary } from '../shared.mjs';

const scopes = [
  {
    kind: 'package',
    relativeDir: 'packages/agent-core',
    shortName: 'agent-core',
    workspaceName: '@robota-sdk/agent-core',
    scripts: {
      build: 'tsup',
      test: 'vitest run',
      lint: 'eslint src --ext .ts',
    },
    hasTsconfig: true,
    workspaceDependencies: [],
  },
  {
    kind: 'package',
    relativeDir: 'packages/agent-provider-openai',
    shortName: 'agent-provider-openai',
    workspaceName: '@robota-sdk/agent-provider-openai',
    scripts: {
      build: 'tsup',
      test: 'vitest run',
      lint: 'eslint src --ext .ts',
    },
    hasTsconfig: true,
    workspaceDependencies: ['@robota-sdk/agent-core'],
  },
];

describe('parsePlanArgs', () => {
  it('parses repeated --changed-file arguments', () => {
    const result = parsePlanArgs([
      '--changed-file',
      'packages/agent-core/src/index.ts',
      '--changed-file',
      '.agents/tasks/example.md',
    ]);

    expect(result.changedFiles).toEqual([
      'packages/agent-core/src/index.ts',
      '.agents/tasks/example.md',
    ]);
  });

  it('parses --skip-dependent-scopes', () => {
    const result = parsePlanArgs(['--skip-dependent-scopes']);

    expect(result.skipDependentScopes).toBe(true);
  });

  it('throws when --changed-file has no value', () => {
    expect(() => parsePlanArgs(['--changed-file'])).toThrow('--changed-file requires a value');
  });
});

describe('createVerificationPlan', () => {
  it('selects only the changed owner scope for a package source file', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/src/agent.ts'],
      scopeTokens: [],
    });

    expect(plan.scopes).toEqual([
      {
        scope: 'packages/agent-core',
        workspaceName: '@robota-sdk/agent-core',
        files: ['packages/agent-core/src/agent.ts'],
        checks: ['build', 'test', 'lint', 'typecheck'],
        notes: [],
      },
    ]);
    expect(plan.unmappedFiles).toEqual([]);
  });

  it('keeps root and policy files visible instead of silently selecting no checks', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['.agents/tasks/example.md'],
      scopeTokens: [],
    });

    expect(plan.scopes).toEqual([]);
    expect(plan.unmappedFiles).toEqual(['.agents/tasks/example.md']);
    expect(plan.repositoryChecks).toEqual(['task-plan-scan']);
  });

  it('selects harness tests for harness script changes', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['scripts/harness/shared.mjs'],
      scopeTokens: [],
    });

    expect(plan.scopes).toEqual([]);
    expect(plan.repositoryChecks).toEqual(['harness-tests', 'harness-consistency']);
  });

  it('selects harness tests for Claude hook changes', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['.claude/hooks/eval-log-stop.sh'],
      scopeTokens: [],
    });

    expect(plan.scopes).toEqual([]);
    expect(plan.repositoryChecks).toEqual(['harness-tests', 'harness-consistency']);
  });

  it('keeps version-only package metadata out of source-heavy package checks', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/package.json'],
      scopeTokens: [],
      manifestChangesByScope: new Map([
        [
          'packages/agent-core',
          {
            kind: 'version-only',
            changedKeys: ['version'],
            hasVersionOnlyChanges: true,
            hasDependencyChanges: false,
            hasPublicSurfaceChanges: false,
            hasScriptOrBuildChanges: false,
            hasPublishMetadataChanges: false,
            hasUnknownManifestChanges: false,
            needsSourceHeavyChecks: false,
          },
        ],
      ]),
    });

    expect(plan.scopes).toEqual([
      {
        scope: 'packages/agent-core',
        workspaceName: '@robota-sdk/agent-core',
        files: ['packages/agent-core/package.json'],
        checks: [],
        notes: ['manifest:version-only'],
      },
    ]);
    expect(plan.repositoryChecks).toEqual(['publish-safety']);
  });

  it('keeps dependency package metadata on build and typecheck without test and lint', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/package.json'],
      scopeTokens: [],
      manifestChangesByScope: new Map([
        [
          'packages/agent-core',
          {
            kind: 'dependency',
            changedKeys: ['dependencies'],
            hasVersionOnlyChanges: false,
            hasDependencyChanges: true,
            hasPublicSurfaceChanges: false,
            hasScriptOrBuildChanges: false,
            hasPublishMetadataChanges: false,
            hasUnknownManifestChanges: false,
            needsSourceHeavyChecks: true,
          },
        ],
      ]),
    });

    expect(plan.scopes[0].checks).toEqual(['build', 'typecheck']);
    expect(plan.scopes[0].notes).toEqual(['manifest:dependency']);
  });

  it('adds dependent scopes for public entrypoint changes', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/src/index.ts'],
      scopeTokens: [],
    });

    expect(plan.scopes).toEqual([
      {
        scope: 'packages/agent-core',
        workspaceName: '@robota-sdk/agent-core',
        files: ['packages/agent-core/src/index.ts'],
        checks: ['build', 'test', 'lint', 'typecheck'],
        notes: [],
      },
      {
        scope: 'packages/agent-provider-openai',
        workspaceName: '@robota-sdk/agent-provider-openai',
        files: [],
        checks: ['typecheck'],
        notes: ['dependent-of:packages/agent-core'],
      },
    ]);
  });

  it('can skip dependent scopes for fast local pre-push verification', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/src/index.ts'],
      scopeTokens: [],
      includeDependentScopes: false,
    });

    expect(plan.scopes).toEqual([
      {
        scope: 'packages/agent-core',
        workspaceName: '@robota-sdk/agent-core',
        files: ['packages/agent-core/src/index.ts'],
        checks: ['build', 'test', 'lint', 'typecheck'],
        notes: [],
      },
    ]);
  });
});

// INFRA-060 D4. Each half is asserted separately: the calculator's selection, and the coverage
// line CI's readers see. The pre-fix defect is pinned in both directions — build tooling must
// select everything, and a docs-only change must still select nothing WITHOUT failing.
describe('workspace-wide build tooling (INFRA-060 D4)', () => {
  it('selects EVERY scope in full for the ordered-types builder — the measured defect', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['scripts/build-types-ordered.mjs'],
      scopeTokens: [],
    });

    // Pre-fix this was `[]`, which made CI's `build` job skip `pnpm build` and its `quality`
    // job verify zero scopes — two REQUIRED checks, both green, on a build-tooling PR.
    expect(plan.scopes.map((item) => item.scope)).toEqual(scopes.map((item) => item.relativeDir));
    for (const item of plan.scopes) {
      expect(item.checks).toEqual(['build', 'test', 'lint', 'typecheck']);
      expect(item.notes).toContain('workspace-wide:scripts/build-types-ordered.mjs');
    }
    expect(plan.workspaceWideTriggers).toEqual(['scripts/build-types-ordered.mjs']);
  });

  it('selects every scope for each declared path, one at a time', () => {
    expect(WORKSPACE_WIDE_BUILD_TOOLING_PATHS.length).toBeGreaterThan(0);

    for (const declaredPath of WORKSPACE_WIDE_BUILD_TOOLING_PATHS) {
      const plan = createVerificationPlan({ scopes, changedFiles: [declaredPath] });
      expect(plan.scopes.length, `${declaredPath} must select the full workspace`).toBe(
        scopes.length,
      );
    }
  });

  it('keeps a semantically proven fixer-only root manifest change out of workspace checks', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['package.json'],
      rootManifestChange: {
        kind: 'developer-quality-only',
        changedScriptKeys: ['harness:work-run'],
        workspaceWide: false,
      },
    });

    expect(plan.scopes).toEqual([]);
    expect(plan.workspaceWideTriggers).toEqual([]);
    expect(plan.rootManifestClassification).toBe('developer-quality-only');
    expect(plan.repositoryChecks).toEqual(['harness-tests', 'harness-consistency']);
    expect(renderPlanSummary(plan)).toContain('Root manifest: developer-quality-only');
  });

  it('fails closed when root manifest semantics are unavailable', () => {
    const plan = createVerificationPlan({ scopes, changedFiles: ['package.json'] });

    expect(plan.scopes).toHaveLength(scopes.length);
    expect(plan.workspaceWideTriggers).toEqual(['package.json']);
    expect(plan.rootManifestClassification).toBe('unclassified-workspace-wide');
  });

  it('leaves a docs-only change at zero scopes — over-correction is the other failure', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['README.md', 'docs/plans/example.md', '.agents/tasks/EXAMPLE-1.md'],
      scopeTokens: [],
    });

    expect(plan.scopes).toEqual([]);
    expect(plan.workspaceWideTriggers).toEqual([]);
  });

  it('leaves an ordinary package change scoped to its owner', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/src/agent.ts'],
    });

    expect(plan.scopes.map((item) => item.scope)).toEqual(['packages/agent-core']);
    expect(plan.workspaceWideTriggers).toEqual([]);
  });

  it('does not widen an explicitly requested scope', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['package.json'],
      scopeTokens: ['packages/agent-core'],
    });

    expect(plan.scopes.map((item) => item.scope)).toEqual(['packages/agent-core']);
    expect(plan.workspaceWideTriggers).toEqual([]);
  });

  it('matches build tooling by exact path, not by prefix', () => {
    expect(listWorkspaceWideTriggers(['package.json'])).toEqual(['package.json']);
    expect(listWorkspaceWideTriggers(['packages/agent-core/package.json'])).toEqual([]);
    expect(listWorkspaceWideTriggers(['scripts/build-types-ordered.mjs.bak'])).toEqual([]);
    expect(listWorkspaceWideTriggers([])).toEqual([]);
  });
});

describe('renderScopeCoverageLine (INFRA-060 D4)', () => {
  it('says in words that nothing was verified when the plan is empty', () => {
    const plan = createVerificationPlan({ scopes, changedFiles: ['README.md'] });

    expect(renderScopeCoverageLine(plan)).toBe(
      `Scope coverage: 0 of ${scopes.length} workspace scopes — this plan verifies NO package or app.`,
    );
  });

  it('states the count and the reason when the whole workspace is selected', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['scripts/build-types-ordered.mjs'],
    });

    expect(renderScopeCoverageLine(plan)).toBe(
      `Scope coverage: ${scopes.length} of ${scopes.length} workspace scopes ` +
        '(workspace-wide build tooling changed: scripts/build-types-ordered.mjs).',
    );
  });

  it('distinguishes a partial plan from an empty one', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/src/agent.ts'],
    });

    expect(renderScopeCoverageLine(plan)).toBe(
      `Scope coverage: 1 of ${scopes.length} workspace scopes.`,
    );
  });
});

describe('renderPlanSummary', () => {
  it('always states the scope coverage, empty or not', () => {
    const empty = createVerificationPlan({ scopes, changedFiles: ['README.md'] });
    const full = createVerificationPlan({ scopes, changedFiles: ['tsconfig.base.json'] });

    expect(renderPlanSummary(empty)).toContain('this plan verifies NO package or app.');
    expect(renderPlanSummary(full)).toContain(
      `Scope coverage: ${scopes.length} of ${scopes.length} workspace scopes`,
    );
  });

  it('renders selected scope checks and unmapped files', () => {
    const plan = createVerificationPlan({
      scopes,
      changedFiles: ['packages/agent-core/src/index.ts', '.agents/tasks/example.md'],
      scopeTokens: [],
    });

    expect(renderPlanSummary(plan)).toContain(
      '- packages/agent-core: build, test, lint, typecheck',
    );
    expect(renderPlanSummary(plan)).toContain('Files outside workspace scopes:');
    expect(renderPlanSummary(plan)).toContain('- .agents/tasks/example.md');
  });
});

// INFRA-060 D4, the visibility half. `renderScopeCoverageLine` is what CI's readers see; this pins
// the delivery path — a line the harness appends to `$GITHUB_STEP_SUMMARY` itself, which is why the
// fix needed no `ci.yml` edit. Verified live on PR #1484: both `build` and `quality` printed
// `Scope coverage: 0 of 86 workspace scopes — this plan verifies NO package or app.`
describe('appendJobSummary (INFRA-060 D4)', () => {
  it('appends inside Actions and writes nothing outside it', () => {
    const target = path.join(makeTemp('job-summary-'), 'summary.md');
    const previous = process.env.GITHUB_STEP_SUMMARY;

    try {
      delete process.env.GITHUB_STEP_SUMMARY;
      expect(appendJobSummary('nothing should be written')).toBe(false);
      expect(existsSync(target)).toBe(false);

      process.env.GITHUB_STEP_SUMMARY = target;
      expect(appendJobSummary('### First')).toBe(true);
      expect(appendJobSummary('### Second\n')).toBe(true);

      // Appends, never replaces: `build` and `quality` each contribute their own line.
      expect(readFileSync(target, 'utf8')).toBe('### First\n### Second\n');
    } finally {
      if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = previous;
      rmSync(path.dirname(target), { recursive: true, force: true });
    }
  });
});
