import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  examinedPopulationCount,
  findPackageBoundaryOwnershipFindings,
  main,
} from '../scan-package-boundary-ownership.mjs';

function fixture() {
  const contents = new Map([
    [
      'packages/shared/package.json',
      JSON.stringify({ name: '@test/shared', exports: { '.': { source: './src/index.ts' } } }),
    ],
    ['packages/shared/docs/SPEC.md', '# Contract\nneutralApi is the owned neutral contract.'],
    ['packages/shared/src/index.ts', 'export const neutralApi = 1;'],
    ['packages/a/package.json', JSON.stringify({ name: '@test/a' })],
    ['packages/a/src/index.ts', "import { neutralApi } from '@test/shared';"],
    ['packages/b/package.json', JSON.stringify({ name: '@test/b' })],
    ['packages/b/src/index.ts', "import { neutralApi } from '@test/shared';"],
  ]);
  const graph = {
    packages: ['shared', 'a', 'b'].map((name) => ({
      name: `@test/${name}`,
      directory: `packages/${name}`,
    })),
  };
  const policy = {
    version: 1,
    sharedCandidates: [
      {
        id: 'neutralApi',
        owner: '@test/shared',
        target: 'packages/shared/src/index.ts',
        contract: 'packages/shared/docs/SPEC.md',
        domainNeutral: 'Value contract independent of consumer scenarios.',
        consumers: ['a', 'b'].map((name) => ({
          source: `packages/${name}/src/index.ts`,
          target: 'packages/shared/src/index.ts',
          kind: 'module',
        })),
      },
    ],
    toolingDispositions: [],
  };
  const inventory = () => ({
    files: new Set(contents.keys()),
    population: [...contents.keys()].map((file) => ({
      path: file,
      owner: graph.packages.find((p) => file.startsWith(`${p.directory}/`))?.name ?? 'repository',
      category: /\.[cm]?[jt]sx?$/.test(file)
        ? 'source'
        : file.endsWith('.md')
          ? 'documentation'
          : 'config',
    })),
    untrackedPopulation: [],
  });
  return {
    contents,
    graph,
    policy,
    inventory,
    run: () =>
      findPackageBoundaryOwnershipFindings('/in-memory', {
        graph,
        policy,
        inventory: inventory(),
        readFile: (file) => {
          if (!contents.has(file)) throw new Error(`missing ${file}`);
          return contents.get(file);
        },
      }),
  };
}

describe('package boundary ownership', () => {
  it('routes cross-owner JSONC configuration references through the shared extractor and resolver', () => {
    const f = fixture();
    f.contents.set('tsconfig.base.json', '{}');
    f.contents.set(
      'packages/a/tsconfig.json',
      '{ /* inherited tooling */ "extends": ["../../tsconfig.base.json"], }',
    );
    expect(f.run().configReferences).toEqual([
      expect.objectContaining({
        source: 'packages/a/tsconfig.json',
        kind: 'config',
        resolution: expect.objectContaining({
          status: 'resolved',
          targets: ['tsconfig.base.json'],
        }),
      }),
    ]);
    expect(f.run().findings).toEqual([
      expect.objectContaining({ code: 'unclassified-boundary', file: 'packages/a/tsconfig.json' }),
    ]);
    f.policy.toolingDispositions.push({
      source: 'packages/a/tsconfig.json',
      target: 'tsconfig.base.json',
      kind: 'config',
      reason: 'Reviewed root compiler defaults.',
    });
    expect(f.run().findings).toEqual([]);
    f.contents.set('packages/a/tsconfig.json', '{}');
    expect(f.run().findings.map((finding) => finding.code)).toContain('stale-declaration');
  });
  it('requires the actual imported API name rather than a different symbol from the same barrel', () => {
    const f = fixture();
    f.contents.set(
      'packages/a/src/index.ts',
      "import { other as neutralApi } from '@test/shared';",
    );
    expect(f.run().findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['candidate-import-evidence', 'shared-consumer-count']),
    );
    f.contents.set(
      'packages/a/src/index.ts',
      "import { neutralApi as localName } from '@test/shared'; import { other } from '@test/shared';",
    );
    expect(f.run().findings).toEqual([]);
  });
  it.each([
    "import * as neutralApi from '@test/shared';",
    "import neutralApi from '@test/shared';",
    "const { neutralApi } = await import('@test/shared');",
    "export { neutralApi } from '@test/shared';",
  ])('does not manufacture a static named import from %s', (source) => {
    const f = fixture();
    f.contents.set('packages/a/src/index.ts', source);
    expect(f.run().findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['candidate-import-evidence', 'shared-consumer-count']),
    );
  });
  it('requires actual references from two different package owners, not two files', () => {
    const f = fixture();
    f.contents.set('packages/b/src/index.ts', 'export {};');
    const result = f.run();
    expect(result.findings.map((finding) => finding.code)).toContain('shared-consumer-count');
    expect(result.findings.map((finding) => finding.code)).toContain('stale-declaration');
    expect(result.counts.tracked).toBe(7);
  });
  it('requires an exact disposition for each private cross-owner reference and rejects stale approvals', () => {
    const f = fixture();
    f.policy.sharedCandidates = [];
    f.contents.set('packages/shared/src/private.ts', 'export const internal = 1;');
    f.contents.set(
      'packages/a/src/index.ts',
      "import { internal } from '../../shared/src/private.js';",
    );
    expect(f.run().findings.map((finding) => finding.code)).toContain('unclassified-boundary');
    f.policy.toolingDispositions.push({
      source: 'packages/a/src/index.ts',
      target: 'packages/shared/src/private.ts',
      kind: 'module',
      reason: 'Approved tooling composition.',
    });
    expect(f.run().findings).toEqual([]);
    f.policy.toolingDispositions[0].kind = 'read-content';
    expect(f.run().findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['unclassified-boundary', 'stale-declaration']),
    );
  });
  it('rejects malformed, wildcard and duplicate registry declarations rather than broad exemptions', () => {
    const f = fixture();
    f.policy.version = 2;
    expect(() => f.run()).toThrow(/policy/);
    f.policy.version = 1;
    f.policy.toolingDispositions = [
      { source: 'packages/a/**', target: 'vitest.shared.ts', kind: 'module', reason: 'all tests' },
    ];
    expect(() => f.run()).toThrow(/policy/);
    f.policy.toolingDispositions = [];
    f.policy.sharedCandidates[0].consumers.push(f.policy.sharedCandidates[0].consumers[0]);
    expect(() => f.run()).toThrow(/policy/);
  });
  it('binds candidate owner, target, named contract and neutrality instead of accepting unrelated declarations', () => {
    const f = fixture();
    expect(f.run().findings).toEqual([]);
    f.policy.sharedCandidates[0].owner = '@test/a';
    expect(f.run().findings.map((finding) => finding.code)).toContain('candidate-owner-contract');
    f.policy.sharedCandidates[0].owner = '@test/shared';
    f.contents.set('packages/shared/docs/SPEC.md', '# Unrelated contract');
    expect(f.run().findings.map((finding) => finding.code)).toContain('candidate-owner-contract');
    f.policy.sharedCandidates[0].domainNeutral = '';
    expect(() => f.run()).toThrow(/policy/);
  });
  it('reports unrelated unknown runtime inputs but refuses a literal unresolved cross-owner target', () => {
    const f = fixture();
    f.contents.set('scripts/tool.mjs', 'await import(runtimeName);');
    expect(f.run().findings).toEqual([]);
    expect(f.run().counts.unknownReferences).toBe(1);
    f.contents.set('packages/a/src/extra.ts', "import '../../shared/src/missing.js';");
    expect(f.run().findings.map((finding) => finding.code)).toContain('unknown-boundary');
  });
  it('does not require a registry edit for an additional public consumer beyond the retention threshold', () => {
    const f = fixture();
    f.contents.set('packages/a/src/another.ts', "import '@test/shared';");
    expect(f.run().findings).toEqual([]);
  });
  it('accepts public source aliases and protects domain APIs without applying the neutral-consumer threshold', () => {
    const f = fixture();
    f.policy.sharedCandidates = [];
    f.contents.set('packages/b/src/index.ts', 'export {};');
    f.contents.set(
      'packages/a/tsconfig.json',
      JSON.stringify({ compilerOptions: { paths: { '@public': ['../shared/src/index.ts'] } } }),
    );
    f.contents.set('packages/a/src/index.ts', "import { neutralApi } from '@public';");
    expect(f.run().findings).toEqual([]);
    f.contents.delete('packages/shared/docs/SPEC.md');
    expect(f.run().findings.map((finding) => finding.code)).toContain('unclassified-boundary');
  });
  it('does not count two files in one package or repository tooling as independent product owners', () => {
    const f = fixture();
    f.contents.set('packages/a/src/second.ts', "import '@test/shared';");
    f.contents.set('scripts/tool.ts', "import '@test/shared';");
    f.contents.set('packages/b/src/index.ts', 'export {};');
    f.policy.sharedCandidates[0].consumers = [
      'packages/a/src/index.ts',
      'packages/a/src/second.ts',
      'scripts/tool.ts',
    ].map((source) => ({ source, target: 'packages/shared/src/index.ts', kind: 'module' }));
    expect(
      f.run().findings.filter((finding) => finding.code === 'shared-consumer-count')[0].message,
    ).toContain('1 independent');
  });
  it('treats file reads of public entries as data boundaries, never public-module exemptions', () => {
    const f = fixture();
    f.policy.sharedCandidates = [];
    f.contents.set(
      'packages/a/src/read.ts',
      "import {readFileSync} from 'node:fs'; readFileSync(new URL('../../shared/src/index.ts', import.meta.url));",
    );
    expect(f.run().findings).toEqual([
      expect.objectContaining({ code: 'unclassified-boundary', file: 'packages/a/src/read.ts' }),
    ]);
    f.policy.toolingDispositions.push({
      source: 'packages/a/src/read.ts',
      target: 'packages/shared/src/index.ts',
      kind: 'read-content',
      reason: 'Exact tooling input.',
    });
    expect(f.run().findings).toEqual([]);
  });
  it('accounts for untracked and excluded population without opening generated or linked content', () => {
    const f = fixture();
    const inventory = f.inventory();
    inventory.untrackedPopulation.push({
      path: 'scratch/new.ts',
      owner: 'repository',
      category: 'source',
    });
    inventory.files.add('scratch/new.ts');
    inventory.population.push(
      { path: 'apps/docs/out/bundle.js', owner: 'repository', category: 'generated' },
      { path: 'linked.ts', owner: 'repository', category: 'symlink' },
      { path: 'mystery.bin', owner: 'repository', category: 'unknown' },
    );
    const reads = [];
    const result = findPackageBoundaryOwnershipFindings('/in-memory', {
      graph: f.graph,
      policy: f.policy,
      inventory,
      readFile: (file) => {
        reads.push(file);
        return file === 'scratch/new.ts' ? 'export {};' : f.contents.get(file);
      },
    });
    expect(result.counts).toMatchObject({
      tracked: 10,
      untracked: 1,
      excluded: 2,
      unknownPopulation: 1,
    });
    expect(reads).not.toContain('apps/docs/out/bundle.js');
    expect(reads).not.toContain('linked.ts');
    expect(reads).toContain('scratch/new.ts');
  });
  it('reuses provided graph reference resolutions without re-extracting their sources', () => {
    const f = fixture();
    const reference = {
      source: 'packages/a/src/index.ts',
      target: 'packages/shared/src/index.ts',
      kind: 'module',
      importedNames: ['neutralApi'],
      resolution: {
        status: 'resolved',
        targets: ['packages/shared/src/index.ts'],
        evidenceInputs: ['packages/shared/package.json'],
      },
    };
    f.graph.packages[1].sourceReferences = [reference];
    f.contents.set(reference.source, 'INVALID CONTENT MUST NOT BE PARSED');
    expect(f.run().findings).toEqual([]);
  });
  it('classifies declared public imports without inventing source targets, but rejects unexported subpaths', () => {
    const f = fixture();
    f.policy.sharedCandidates = [];
    f.contents.set(
      'packages/shared/package.json',
      JSON.stringify({
        name: '@test/shared',
        exports: {
          '.': { import: './dist/index.js', require: './dist/index.cjs' },
          './private': null,
        },
      }),
    );
    expect(f.run().findings).toEqual([]);
    expect(f.run().counts.unknownReferences).toBe(2);
    f.contents.set('packages/b/src/index.ts', "import '@test/shared/private';");
    expect(f.run().findings.map((finding) => finding.code)).toContain('unknown-boundary');
  });
  it('keeps reviewed runtime aliases distinct from exact tooling dispositions', () => {
    const f = fixture();
    f.policy.sharedCandidates = [];
    f.contents.set('packages/shared/src/implementation.ts', 'export const neutralApi = 1;');
    f.contents.set('packages/a/src/index.ts', "import '../../shared/src/implementation.js';");
    const configPath = 'packages/shared/tsdown.config.ts';
    const config = "export default { entry: ['src/implementation.ts'] };";
    f.contents.set(configPath, config);
    f.policy.publicDispositions = [
      {
        source: 'packages/a/src/index.ts',
        target: 'packages/shared/src/implementation.ts',
        kind: 'module',
        publicSpecifier: '@test/shared',
        reason: 'Reviewed source-to-export implementation correspondence.',
        binding: {
          exportsSha256: createHash('sha256')
            .update(
              JSON.stringify(JSON.parse(f.contents.get('packages/shared/package.json')).exports),
            )
            .digest('hex'),
          config: { path: configPath, sha256: createHash('sha256').update(config).digest('hex') },
        },
      },
    ];
    expect(f.run().findings).toEqual([]);
    f.policy.publicDispositions[0].publicSpecifier = '@test/shared/unexported';
    expect(f.run().findings.map((finding) => finding.code)).toContain('invalid-public-disposition');
  });
  it('invalidates audited runtime alias correspondence when only the export shape changes', () => {
    const f = fixture();
    f.policy.sharedCandidates = [];
    f.contents.set('packages/shared/src/implementation.ts', 'export const neutralApi = 1;');
    f.contents.set('packages/shared/src/replacement.ts', 'export const replacement = 1;');
    f.contents.set('packages/a/src/index.ts', "import '../../shared/src/implementation.js';");
    const configPath = 'packages/shared/tsdown.config.ts';
    const config = "export default { entry: ['src/implementation.ts'], outDir: 'dist/node' };";
    f.contents.set(configPath, config);
    const manifest = JSON.parse(f.contents.get('packages/shared/package.json'));
    const sha = (text) => createHash('sha256').update(text).digest('hex');
    f.policy.publicDispositions = [
      {
        source: 'packages/a/src/index.ts',
        target: 'packages/shared/src/implementation.ts',
        kind: 'module',
        publicSpecifier: '@test/shared',
        reason: 'Reviewed source-to-export correspondence.',
        binding: {
          exportsSha256: sha(JSON.stringify(manifest.exports)),
          config: { path: configPath, sha256: sha(config) },
        },
      },
    ];
    expect(f.run().findings).toEqual([]);
    manifest.version = '99.0.0';
    f.contents.set('packages/shared/package.json', JSON.stringify(manifest, null, 2));
    expect(f.run().findings).toEqual([]);
    manifest.exports['.'].source = './src/replacement.ts';
    f.contents.set('packages/shared/package.json', JSON.stringify(manifest));
    expect(f.run().findings.map((finding) => finding.code)).toContain('stale-public-binding');
  });
  it('invalidates audited correspondence when the compiler entry changes without changing exports', () => {
    const f = fixture();
    f.policy.sharedCandidates = [];
    f.contents.set('packages/shared/src/implementation.ts', 'export const neutralApi = 1;');
    f.contents.set('packages/a/src/index.ts', "import '../../shared/src/implementation.js';");
    const configPath = 'packages/shared/tsdown.config.ts';
    const config = "export default { entry: ['src/implementation.ts'], outDir: 'dist/node' };";
    f.contents.set(configPath, config);
    const sha = (text) => createHash('sha256').update(text).digest('hex');
    f.policy.publicDispositions = [
      {
        source: 'packages/a/src/index.ts',
        target: 'packages/shared/src/implementation.ts',
        kind: 'module',
        publicSpecifier: '@test/shared',
        reason: 'Reviewed compiler input-to-export correspondence.',
        binding: {
          exportsSha256: sha(
            JSON.stringify(JSON.parse(f.contents.get('packages/shared/package.json')).exports),
          ),
          config: { path: configPath, sha256: sha(config) },
        },
      },
    ];
    expect(f.run().findings).toEqual([]);
    f.contents.set(
      configPath,
      "export default { entry: ['src/replacement.ts'], outDir: 'dist/node' };",
    );
    expect(f.run().findings.map((finding) => finding.code)).toContain('stale-public-binding');
  });
  it('summarizes large unknown populations in CLI output while preserving full finder evidence and findings', () => {
    const f = fixture();
    f.graph.packages[0].sourceReferences = Array.from({ length: 2400 }, (_, index) => ({
      source: 'packages/shared/src/index.ts',
      kind: 'read-content',
      expression: `FULL_REFERENCE_ONLY_${index}`,
      span: { start: index, end: index + 1 },
      resolution: {
        status: 'unresolved',
        reason: index % 2 ? 'missing-cwd' : 'nonliteral-reference',
        evidenceInputs: [],
      },
    }));
    f.contents.set('packages/a/src/private-read.ts', "import '../../shared/src/missing.js';");
    const evidence = f.run();
    expect(evidence.unknownReferences).toHaveLength(2401);
    expect(evidence.unknownReferences[0].expression).toBe('FULL_REFERENCE_ONLY_0');
    const output = [];
    expect(
      main(
        {
          root: '/in-memory',
          graph: f.graph,
          policy: f.policy,
          inventory: f.inventory(),
          readFile: (file) => f.contents.get(file),
        },
        (text) => output.push(text),
      ),
    ).toBe(1);
    const summary = JSON.parse(output[1]);
    expect(summary.counts.unknownReferences).toBe(2401);
    expect(summary.unknownReasons).toEqual({
      'nonliteral-reference': 1200,
      'missing-cwd': 1200,
      'missing-target': 1,
    });
    expect(summary.findings).toEqual(evidence.findings);
    expect(summary).not.toHaveProperty('unknownReferences');
    expect(output.join('\n')).not.toContain('FULL_REFERENCE_ONLY_');
    expect(output.join('\n').length).toBeLessThan(4000);
  });
  it('emits population and unknown diagnostics and returns a failing CLI status on invalid input', () => {
    const f = fixture();
    const output = [];
    const options = {
      root: '/in-memory',
      graph: f.graph,
      policy: f.policy,
      inventory: f.inventory(),
      readFile: (file) => f.contents.get(file),
    };
    expect(main(options, (text) => output.push(text))).toBe(0);
    expect(output.join('\n')).toContain('::examined:: 7');
    expect(output.join('\n')).toContain('unknownReferences');
    f.policy.version = 0;
    expect(main(options, (text) => output.push(text))).toBe(1);
    expect(output.join('\n')).toContain('FAILED');
    expect(examinedPopulationCount()).toBe(0);
  });
  it('resets the exact measured population after a second direct finder call on a different population', () => {
    const f = fixture();
    const options = { graph: f.graph, policy: f.policy, readFile: (file) => f.contents.get(file) };
    const first = findPackageBoundaryOwnershipFindings('/in-memory', {
      ...options,
      inventory: f.inventory(),
    });
    expect(first.findings).toEqual([]);
    expect(examinedPopulationCount()).toBe(7);
    f.contents.set('notes.md', '# Population increment');
    const second = findPackageBoundaryOwnershipFindings('/in-memory', {
      ...options,
      inventory: f.inventory(),
    });
    expect(second.findings).toEqual([]);
    expect(examinedPopulationCount()).toBe(8);
  });
});
