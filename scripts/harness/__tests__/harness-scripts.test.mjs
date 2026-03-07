import { describe, it, expect } from 'vitest';
import {
  parseScopeArgs,
  classifyScopeChanges,
  mapFilesToScopes,
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

  it('parses --report-file path and --report-format json', () => {
    const result = parseScopeArgs([
      '--report-file', 'output.json',
      '--report-format', 'json',
    ]);
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
      skipTests: false,
      skipLint: false,
      skipTypecheck: false,
      includeScenarios: false,
      reportFile: null,
      reportFormat: null,
      baseRef: null,
    });
  });
});

// ---------------------------------------------------------------------------
// classifyScopeChanges
// ---------------------------------------------------------------------------
describe('classifyScopeChanges', () => {
  const scope = {
    relativeDir: 'packages/agents',
    shortName: 'agents',
    workspaceName: '@robota-sdk/agents',
    scripts: {},
    hasTsconfig: true,
  };

  it('detects source changes for files in src/', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/agent.ts'],
      false,
    );
    expect(result.hasSourceChanges).toBe(true);
  });

  it('detects test changes for .test.ts files', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/agent.test.ts'],
      false,
    );
    expect(result.hasTestChanges).toBe(true);
  });

  it('detects test changes for files in __tests__/', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/__tests__/agent.ts'],
      false,
    );
    expect(result.hasTestChanges).toBe(true);
  });

  it('detects config changes for package.json', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/package.json'],
      false,
    );
    expect(result.hasConfigChanges).toBe(true);
  });

  it('detects config changes for tsconfig.json', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/tsconfig.json'],
      false,
    );
    expect(result.hasConfigChanges).toBe(true);
  });

  it('detects scenario changes for files in examples/', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/examples/basic.ts'],
      false,
    );
    expect(result.hasScenarioChanges).toBe(true);
  });

  it('detects scenario changes for files containing "scenario"', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/scenario/run.ts'],
      false,
    );
    expect(result.hasScenarioChanges).toBe(true);
  });

  it('detects entrypoint changes for src/index.ts', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/index.ts'],
      false,
    );
    expect(result.hasEntrypointChanges).toBe(true);
  });

  it('sets needsBuild = true when source changes exist', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/core.ts'],
      false,
    );
    expect(result.needsBuild).toBe(true);
  });

  it('sets needsBuild = true when config changes exist', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/package.json'],
      false,
    );
    expect(result.needsBuild).toBe(true);
  });

  it('sets needsTest = true when source changes exist', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/core.ts'],
      false,
    );
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTest = true when test changes exist', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/agent.test.ts'],
      false,
    );
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTest = true when config changes exist', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/package.json'],
      false,
    );
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTypecheck = true only when hasTsconfig is true', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/core.ts'],
      false,
    );
    expect(result.needsTypecheck).toBe(true);

    const scopeNoTsconfig = { ...scope, hasTsconfig: false };
    const resultNoTsconfig = classifyScopeChanges(
      scopeNoTsconfig,
      ['packages/agents/src/core.ts'],
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

  it('sets needsBuild = true when test files are under src/', () => {
    // Test files under src/ trigger hasSourceChanges, so needsBuild is true
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/src/agent.test.ts'],
      false,
    );
    expect(result.needsBuild).toBe(true);
  });

  it('sets needsBuild = false when test files are only in __tests__/', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agents/__tests__/agent.test.ts'],
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
      relativeDir: 'packages/agents',
      shortName: 'agents',
      workspaceName: '@robota-sdk/agents',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'packages/openai',
      shortName: 'openai',
      workspaceName: '@robota-sdk/openai',
      scripts: {},
      hasTsconfig: true,
    },
  ];

  it('maps files to the correct scope', () => {
    const files = [
      'packages/agents/src/agent.ts',
      'packages/openai/src/provider.ts',
    ];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agents')).toEqual(['packages/agents/src/agent.ts']);
    expect(result.get('packages/openai')).toEqual(['packages/openai/src/provider.ts']);
  });

  it('does not map files outside any scope', () => {
    const files = ['scripts/harness/shared.mjs'];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agents')).toEqual([]);
    expect(result.get('packages/openai')).toEqual([]);
  });

  it('maps multiple files to the same scope', () => {
    const files = [
      'packages/agents/src/agent.ts',
      'packages/agents/src/plugin.ts',
    ];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agents')).toEqual([
      'packages/agents/src/agent.ts',
      'packages/agents/src/plugin.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveRequestedScopes
// ---------------------------------------------------------------------------
describe('resolveRequestedScopes', () => {
  const scopes = [
    {
      relativeDir: 'packages/agents',
      shortName: 'agents',
      workspaceName: '@robota-sdk/agents',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'packages/openai',
      shortName: 'openai',
      workspaceName: '@robota-sdk/openai',
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
    const result = resolveRequestedScopes(['packages/agents'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agents');
  });

  it('matches by workspaceName', () => {
    const result = resolveRequestedScopes(['@robota-sdk/openai'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/openai');
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
        relativeDir: 'packages/openai-v2',
        shortName: 'openai',
        workspaceName: '@robota-sdk/openai-v2',
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
      ['packages/agents', 'agents', '@robota-sdk/agents'],
      scopes,
    );
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agents');
  });
});
