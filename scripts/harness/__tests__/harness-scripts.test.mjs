import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import {
  parseScopeArgs,
  classifyScopeChanges,
  classifyPackageManifestChange,
  createWorkspaceDependencyBuildArgs,
  mapFilesToScopes,
  resolveBaseRef,
  resolveRequestedScopes,
} from '../shared.mjs';

// ---------------------------------------------------------------------------
// parseScopeArgs
// ---------------------------------------------------------------------------
describe('parseScopeArgs', () => {
  it('parses --scope packages/foo correctly', () => {
    const result = parseScopeArgs(['--scope', 'packages/foo']);
    expect(result.scopeTokens).toEqual(['packages/foo']);
  });

  it('parses --dry-run flag', () => {
    const result = parseScopeArgs(['--dry-run']);
    expect(result.dryRun).toBe(true);
  });

  it('parses --skip-tests flag', () => {
    const result = parseScopeArgs(['--skip-tests']);
    expect(result.skipTests).toBe(true);
  });

  it('parses --skip-lint flag', () => {
    const result = parseScopeArgs(['--skip-lint']);
    expect(result.skipLint).toBe(true);
  });

  it('parses --skip-typecheck flag', () => {
    const result = parseScopeArgs(['--skip-typecheck']);
    expect(result.skipTypecheck).toBe(true);
  });

  it('parses --include-scenarios flag', () => {
    const result = parseScopeArgs(['--include-scenarios']);
    expect(result.includeScenarios).toBe(true);
  });

  it('parses --skip-repository-checks flag', () => {
    const result = parseScopeArgs(['--skip-repository-checks']);
    expect(result.skipRepositoryChecks).toBe(true);
  });

  it('parses --report-file path and --report-format json', () => {
    const result = parseScopeArgs(['--report-file', 'output.json', '--report-format', 'json']);
    expect(result.reportFile).toBe('output.json');
    expect(result.reportFormat).toBe('json');
  });

  it('parses --base-ref main', () => {
    const result = parseScopeArgs(['--base-ref', 'main']);
    expect(result.baseRef).toBe('main');
  });

  it('throws on unknown argument', () => {
    expect(() => parseScopeArgs(['--unknown'])).toThrow('Unknown argument: --unknown');
  });

  it('throws on --scope without value', () => {
    expect(() => parseScopeArgs(['--scope'])).toThrow('--scope requires a value');
  });

  it('throws on --report-format with invalid value', () => {
    expect(() => parseScopeArgs(['--report-format', 'xml'])).toThrow(
      '--report-format must be one of: markdown, json',
    );
  });

  it('returns correct defaults when no arguments are provided', () => {
    const result = parseScopeArgs([]);
    expect(result).toEqual({
      scopeTokens: [],
      dryRun: false,
      skipBuild: false,
      skipTests: false,
      skipLint: false,
      skipTypecheck: false,
      includeScenarios: false,
      skipRecordCheck: false,
      skipRepositoryChecks: false,
      reportFile: null,
      reportFormat: null,
      baseRef: null,
    });
  });
});

// ---------------------------------------------------------------------------
// createWorkspaceDependencyBuildArgs
// ---------------------------------------------------------------------------
describe('createWorkspaceDependencyBuildArgs', () => {
  it('renders a pnpm dependency-only filter for clean scoped verification', () => {
    const result = createWorkspaceDependencyBuildArgs({
      workspaceName: '@robota-sdk/agent-cli',
      workspaceDependencies: ['@robota-sdk/agent-command-agent'],
    });

    expect(result).toEqual(['--filter', '@robota-sdk/agent-cli^...', '--if-present', 'build']);
  });

  it('returns null when a scope has no workspace dependencies', () => {
    const result = createWorkspaceDependencyBuildArgs({
      workspaceName: '@robota-sdk/agent-core',
      workspaceDependencies: [],
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pre-push hook
// ---------------------------------------------------------------------------
describe('pre-push hook', () => {
  it('delegates to harness:pre-push without hardcoding origin/main or dist scan', () => {
    const content = readFileSync('.husky/pre-push', 'utf8');

    expect(content).toContain('pnpm harness:pre-push');
    expect(content).not.toContain('origin/main');
    expect(content).not.toContain('harness:scan:dist');
  });
});

// ---------------------------------------------------------------------------
// release verification
// ---------------------------------------------------------------------------
describe('release verification script', () => {
  it('builds before running harness:scan so dist freshness has artifacts in clean CI', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
    const releaseScript = rootPackage.scripts['harness:verify:release'];

    expect(releaseScript).toContain('pnpm build:deps');
    expect(releaseScript).toContain('pnpm harness:scan');
    expect(releaseScript.indexOf('pnpm build:deps')).toBeLessThan(
      releaseScript.indexOf('pnpm harness:scan'),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBaseRef
// ---------------------------------------------------------------------------
describe('resolveBaseRef', () => {
  it('uses an explicit base ref without probing fallback refs', () => {
    const result = resolveBaseRef({
      explicitBaseRef: 'origin/custom',
      env: {},
      refExists: () => false,
    });

    expect(result).toBe('origin/custom');
  });

  it('uses HARNESS_BASE_REF before GitHub base refs', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {
        HARNESS_BASE_REF: 'origin/release',
        GITHUB_BASE_REF: 'main',
      },
      refExists: (ref) => ref === 'origin/release' || ref === 'origin/main',
    });

    expect(result).toBe('origin/release');
  });

  it('prefers origin GitHub base refs when running in pull request context', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {
        GITHUB_BASE_REF: 'main',
      },
      refExists: (ref) => ref === 'origin/main',
    });

    expect(result).toBe('origin/main');
  });

  it('defaults feature branch development to origin/develop when available', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {},
      refExists: (ref) => ref === 'origin/develop' || ref === 'origin/main',
    });

    expect(result).toBe('origin/develop');
  });

  it('falls back to main only when develop refs are unavailable', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {},
      refExists: (ref) => ref === 'main',
    });

    expect(result).toBe('main');
  });

  it('returns null when no candidate refs exist', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {},
      refExists: () => false,
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyPackageManifestChange
// ---------------------------------------------------------------------------
describe('classifyPackageManifestChange', () => {
  it('detects version-only package manifest changes', () => {
    const result = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', version: '1.0.0' },
      after: { name: '@robota-sdk/agent-core', version: '1.0.1' },
    });

    expect(result.kind).toBe('version-only');
    expect(result.hasVersionOnlyChanges).toBe(true);
    expect(result.needsSourceHeavyChecks).toBe(false);
  });

  it('detects dependency package manifest changes', () => {
    const result = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', dependencies: { zod: '^3.0.0' } },
      after: { name: '@robota-sdk/agent-core', dependencies: { zod: '^4.0.0' } },
    });

    expect(result.kind).toBe('dependency');
    expect(result.hasDependencyChanges).toBe(true);
    expect(result.needsSourceHeavyChecks).toBe(true);
  });

  it('detects public surface package manifest changes', () => {
    const result = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', exports: { '.': './dist/index.js' } },
      after: {
        name: '@robota-sdk/agent-core',
        exports: { '.': './dist/index.js', './tools': './dist/tools.js' },
      },
    });

    expect(result.kind).toBe('public-surface');
    expect(result.hasPublicSurfaceChanges).toBe(true);
    expect(result.needsSourceHeavyChecks).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyScopeChanges
// ---------------------------------------------------------------------------
describe('classifyScopeChanges', () => {
  const scope = {
    relativeDir: 'packages/agent-core',
    shortName: 'agents',
    workspaceName: '@robota-sdk/agent-core',
    scripts: {},
    hasTsconfig: true,
  };

  it('detects production source changes for files in src/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.ts'], false);
    expect(result.hasSourceChanges).toBe(true);
  });

  it('detects test changes for .test.ts files without classifying them as production source', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.test.ts'], false);
    expect(result.hasTestChanges).toBe(true);
    expect(result.hasSourceChanges).toBe(false);
  });

  it('detects test changes for files in __tests__/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/__tests__/agent.ts'], false);
    expect(result.hasTestChanges).toBe(true);
  });

  it('detects config changes for package.json', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false);
    expect(result.hasConfigChanges).toBe(true);
  });

  it('detects config changes for tsconfig.json', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/tsconfig.json'], false);
    expect(result.hasConfigChanges).toBe(true);
  });

  it('detects scenario changes for files in examples/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/examples/basic.ts'], false);
    expect(result.hasScenarioChanges).toBe(true);
  });

  it('detects scenario changes for files containing "scenario"', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/scenario/run.ts'], false);
    expect(result.hasScenarioChanges).toBe(true);
  });

  it('detects entrypoint changes for src/index.ts', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/index.ts'], false);
    expect(result.hasEntrypointChanges).toBe(true);
  });

  it('sets needsBuild = true when source changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/core.ts'], false);
    expect(result.needsBuild).toBe(true);
  });

  it('does not run source-heavy checks for version-only package manifest changes', () => {
    const manifestChange = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', version: '1.0.0' },
      after: { name: '@robota-sdk/agent-core', version: '1.0.1' },
    });
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false, {
      manifestChange,
    });

    expect(result.hasVersionOnlyManifestChanges).toBe(true);
    expect(result.needsBuild).toBe(false);
    expect(result.needsTest).toBe(false);
    expect(result.needsLint).toBe(false);
    expect(result.needsTypecheck).toBe(false);
  });

  it('runs build and typecheck for dependency package manifest changes', () => {
    const manifestChange = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', dependencies: { zod: '^3.0.0' } },
      after: { name: '@robota-sdk/agent-core', dependencies: { zod: '^4.0.0' } },
    });
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false, {
      manifestChange,
    });

    expect(result.hasDependencyManifestChanges).toBe(true);
    expect(result.needsBuild).toBe(true);
    expect(result.needsTypecheck).toBe(true);
    expect(result.needsTest).toBe(false);
    expect(result.needsLint).toBe(false);
  });

  it('sets needsTest = true when source changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/core.ts'], false);
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTest = true when test changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.test.ts'], false);
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTest = true when config changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false);
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTypecheck = true only when hasTsconfig is true', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/core.ts'], false);
    expect(result.needsTypecheck).toBe(true);

    const scopeNoTsconfig = { ...scope, hasTsconfig: false };
    const resultNoTsconfig = classifyScopeChanges(
      scopeNoTsconfig,
      ['packages/agent-core/src/core.ts'],
      false,
    );
    expect(resultNoTsconfig.needsTypecheck).toBe(false);
  });

  it('sets all needs* flags to true when forceFullVerification is true', () => {
    const result = classifyScopeChanges(scope, [], true);
    expect(result.needsBuild).toBe(true);
    expect(result.needsTest).toBe(true);
    expect(result.needsLint).toBe(true);
    expect(result.needsTypecheck).toBe(true);
  });

  it('sets needsBuild = false when test files are under src/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.test.ts'], false);
    expect(result.needsBuild).toBe(false);
  });

  it('sets needsBuild = false when test files are only in __tests__/', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agent-core/__tests__/agent.test.ts'],
      false,
    );
    expect(result.needsBuild).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapFilesToScopes
// ---------------------------------------------------------------------------
describe('mapFilesToScopes', () => {
  const scopes = [
    {
      relativeDir: 'packages/agent-core',
      shortName: 'agents',
      workspaceName: '@robota-sdk/agent-core',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'packages/agent-provider-openai',
      shortName: 'openai',
      workspaceName: '@robota-sdk/agent-provider-openai',
      scripts: {},
      hasTsconfig: true,
    },
  ];

  it('maps files to the correct scope', () => {
    const files = [
      'packages/agent-core/src/agent.ts',
      'packages/agent-provider-openai/src/provider.ts',
    ];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agent-core')).toEqual(['packages/agent-core/src/agent.ts']);
    expect(result.get('packages/agent-provider-openai')).toEqual([
      'packages/agent-provider-openai/src/provider.ts',
    ]);
  });

  it('does not map files outside any scope', () => {
    const files = ['scripts/harness/shared.mjs'];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agent-core')).toEqual([]);
    expect(result.get('packages/agent-provider-openai')).toEqual([]);
  });

  it('maps multiple files to the same scope', () => {
    const files = ['packages/agent-core/src/agent.ts', 'packages/agent-core/src/plugin.ts'];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agent-core')).toEqual([
      'packages/agent-core/src/agent.ts',
      'packages/agent-core/src/plugin.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveRequestedScopes
// ---------------------------------------------------------------------------
describe('resolveRequestedScopes', () => {
  const scopes = [
    {
      relativeDir: 'packages/agent-core',
      shortName: 'agents',
      workspaceName: '@robota-sdk/agent-core',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'packages/agent-provider-openai',
      shortName: 'openai',
      workspaceName: '@robota-sdk/agent-provider-openai',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'apps/web',
      shortName: 'web',
      workspaceName: '@robota/web',
      scripts: {},
      hasTsconfig: true,
    },
  ];

  it('matches by relativeDir', () => {
    const result = resolveRequestedScopes(['packages/agent-core'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agent-core');
  });

  it('matches by workspaceName', () => {
    const result = resolveRequestedScopes(['@robota-sdk/agent-provider-openai'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agent-provider-openai');
  });

  it('matches by shortName', () => {
    const result = resolveRequestedScopes(['web'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('apps/web');
  });

  it('throws on unknown scope', () => {
    expect(() => resolveRequestedScopes(['packages/nonexistent'], scopes)).toThrow(
      'Unknown scope: packages/nonexistent',
    );
  });

  it('throws on ambiguous scope', () => {
    const scopesWithAmbiguity = [
      ...scopes,
      {
        relativeDir: 'packages/agent-provider-openai-v2',
        shortName: 'openai',
        workspaceName: '@robota-sdk/agent-provider-openai-v2',
        scripts: {},
        hasTsconfig: true,
      },
    ];
    expect(() => resolveRequestedScopes(['openai'], scopesWithAmbiguity)).toThrow(
      /Ambiguous scope: openai/,
    );
  });

  it('deduplicates resolved scopes', () => {
    const result = resolveRequestedScopes(
      ['packages/agent-core', 'agents', '@robota-sdk/agent-core'],
      scopes,
    );
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agent-core');
  });
});
