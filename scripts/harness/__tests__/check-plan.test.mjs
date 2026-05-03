import { describe, expect, it } from 'vitest';

import { createVerificationPlan, parsePlanArgs, renderPlanSummary } from '../check-plan.mjs';

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
});

describe('renderPlanSummary', () => {
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
