import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import * as enumeration from '../enumerate-files.mjs';
import * as resolution from '../workspace-source-reference-resolution.mjs';
import { makeTemp } from './make-temp.mjs';

import {
  CONTRACT_CONTROL_PLANE_INPUTS,
  CONTRACT_SAFETY_FLOOR,
  createContractTestRegistry,
  resolveContractTestInputs,
  validateContractTestRegistry,
  validateContractReferenceEvidence,
  validateContractInputProjection,
} from '../contract-test-inputs.mjs';

it('exports the same refusal checks for cache callers without whole-registry validation', () => {
  const { root, context } = fixture({
    [TEST]: "import '../helper.mjs';",
    'scripts/harness/helper.mjs': '',
  });
  const [entry] = createContractTestRegistry(root, [TEST], context);
  expect(() => validateContractReferenceEvidence(entry.references)).not.toThrow();
  expect(() => validateContractInputProjection(entry)).not.toThrow();
  const malformed = structuredClone(entry.references);
  malformed[0].resolution.targets = 'not-an-array';
  expect(() => validateContractReferenceEvidence(malformed)).toThrow(/invalid contract reference/);
});

const TEST = 'scripts/harness/__tests__/example.test.mjs';
afterEach(() => {
  vi.restoreAllMocks();
});

it('uses the enumeration owner including unstaged new source without requiring fixture Git', () => {
  const { root, context } = fixture({
    [TEST]: "import '../new-helper.mjs';",
    'scripts/harness/new-helper.mjs': '',
  });
  const collect = vi.spyOn(enumeration, 'collectFiles').mockReturnValue([...context.files]);
  const [entry] = createContractTestRegistry(root, [TEST]);
  expect(collect).toHaveBeenCalledWith([], { cwd: root, includeUntracked: true });
  expect(entry.implementationInputs).toContain('scripts/harness/new-helper.mjs');
});

it('expands undisposed dynamic evidence to an always-run noncacheable entry', () => {
  const { root, context } = fixture({ [TEST]: 'await import(selectedModule);' });
  const registry = createContractTestRegistry(root, [TEST], context);
  expect(registry[0].references).toEqual([
    expect.objectContaining({
      source: TEST,
      kind: 'module',
      expression: 'selectedModule',
      resolution: expect.objectContaining({ status: 'unresolved', reason: 'nonliteral-reference' }),
    }),
  ]);
  expect(resolveContractTestInputs(root, TEST, context).uncertainInputs).toEqual([
    expect.objectContaining({ reason: 'nonliteral-reference' }),
  ]);
  const [entry] = registry;
  expect(entry).toMatchObject({
    always: true,
    alwaysReason: '1 unresolved repository input(s) lack an explicit disposition',
    cacheable: false,
    uncertaintyDispositions: [],
  });
  expect(entry.uncertainInputs).toEqual([
    {
      referenceId: entry.references[0].id,
      source: TEST,
      span: entry.references[0].span,
      kind: 'module',
      expression: 'selectedModule',
      reason: 'nonliteral-reference',
    },
  ]);
  expect(validateContractReferenceEvidence(entry.references)).toEqual(entry.uncertainInputs);
  expect(validateContractInputProjection(entry)).toEqual(entry.uncertainInputs);
  expect(validateContractTestRegistry(root, [TEST], registry)).toBe(registry);
});

function fixture(entries) {
  const root = makeTemp('robota-contract-input-references-');
  for (const [file, text] of Object.entries(entries)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return {
    root,
    context: {
      files: new Set(Object.keys(entries)),
      packages: [],
      readFile: (file) => readFileSync(path.join(root, file), 'utf8'),
    },
  };
}

it('refuses removing uncertainty or its noncacheable policy', () => {
  const { root, context } = fixture({ [TEST]: 'await import(selectedModule);' });
  const [entry] = createContractTestRegistry(root, [TEST], context);
  for (const patch of [
    { uncertainInputs: [] },
    { uncertainInputs: undefined },
    { cacheable: true },
    { cacheable: undefined },
  ]) {
    expect(() => validateContractInputProjection({ ...entry, ...patch })).toThrow(/uncertainty/);
  }
});

it('rejects malformed unresolved evidence rather than calling it an uncertainty', () => {
  const { root, context } = fixture({ [TEST]: 'await import(selectedModule);' });
  const [entry] = createContractTestRegistry(root, [TEST], context);
  const original = entry.references[0];
  for (const patch of [
    { expression: undefined },
    { expression: '' },
    { id: undefined },
    { resolution: { status: 'unresolved' } },
    { resolution: { status: 'unresolved', reason: '' } },
    { resolution: { status: 'unresolved', reason: 'unknown', targets: [TEST] } },
  ]) {
    expect(() => validateContractReferenceEvidence([{ ...original, ...patch }])).toThrow(
      /invalid contract reference/,
    );
  }
});

it('preserves safety-floor reasons and leaves unrelated resolved entries cacheable', () => {
  const floor = CONTRACT_SAFETY_FLOOR[0];
  const { root, context } = fixture({
    [floor.test]: 'await import(selectedModule);',
    [TEST]: 'export const value = true;',
  });
  const registry = createContractTestRegistry(root, [floor.test, TEST], context);
  const uncertain = registry.find((entry) => entry.test === floor.test);
  expect(uncertain).toMatchObject({ always: true, alwaysReason: floor.reason, cacheable: false });
  expect(uncertain.uncertainInputs).toHaveLength(1);
  expect(registry.find((entry) => entry.test === TEST)).toMatchObject({
    always: false,
    alwaysReason: null,
    cacheable: true,
    uncertainInputs: [],
  });
  expect(
    validateContractTestRegistry(
      root,
      registry.map((entry) => entry.test),
      registry,
    ),
  ).toBe(registry);
});

it('normalizes a resolved root name-set to the canonical immediate-entry pattern', () => {
  const { root, context } = fixture({
    [TEST]:
      "import { readdirSync } from 'node:fs'; readdirSync(new URL('../../../', import.meta.url));",
  });
  const resolve = resolution.resolveSourceReference;
  vi.spyOn(resolution, 'resolveSourceReference').mockImplementation((reference, context) =>
    reference.kind === 'list-names'
      ? { ...reference, resolution: { status: 'resolved', targets: ['.'], evidenceInputs: [] } }
      : resolve(reference, context),
  );
  const [entry] = createContractTestRegistry(root, [TEST], context);
  expect(entry.repositoryInputs).toEqual(['*']);
  expect(entry.projectedInputs).toContainEqual({
    targetOrPattern: '*',
    sensitivity: 'name-set',
    referenceIds: [expect.any(String)],
  });
  expect(validateContractTestRegistry(root, [TEST], [entry])).toEqual([entry]);
});

it('does not recurse into executable-looking string data or fake imports in comments', () => {
  const { root, context } = fixture({
    [TEST]: `import '../actual.mjs';
      // import '../comment.mjs';
      const example = "import '../string.mjs'";
      const filename = '../data.mjs';`,
    'scripts/harness/actual.mjs': 'export const value = 1;',
    'scripts/harness/comment.mjs': "import './unrelated.mjs';",
    'scripts/harness/string.mjs': "import './unrelated.mjs';",
    'scripts/harness/data.mjs': "import './unrelated.mjs';",
    'scripts/harness/unrelated.mjs': '',
  });
  expect(resolveContractTestInputs(root, TEST, context).implementationInputs).toEqual([
    TEST,
    'scripts/harness/actual.mjs',
  ]);
  const [entry] = createContractTestRegistry(root, [TEST], context);
  expect(entry.implementationInputs).toEqual([TEST, 'scripts/harness/actual.mjs']);
  expect(entry.repositoryInputs).toEqual([]);
});

it('projects real content reads without executing imports found inside the data', () => {
  const { root, context } = fixture({
    [TEST]: `import { readFileSync } from 'node:fs';
      readFileSync(new URL('../data.mjs', import.meta.url), 'utf8');`,
    'scripts/harness/data.mjs': "import './not-executed.mjs';",
    'scripts/harness/not-executed.mjs': '',
  });
  const [entry] = createContractTestRegistry(root, [TEST], context);
  expect(entry.implementationInputs).toEqual([TEST]);
  expect(entry.repositoryInputs).toEqual(['scripts/harness/data.mjs']);
  expect(entry.projectedInputs).toContainEqual({
    targetOrPattern: 'scripts/harness/data.mjs',
    sensitivity: 'content',
    referenceIds: [expect.any(String)],
  });
  const ref = entry.references.find((reference) => reference.kind === 'read-content');
  expect(
    entry.projectedInputs.find((input) => input.targetOrPattern === 'scripts/harness/data.mjs')
      .referenceIds,
  ).toEqual([ref.id]);
  expect(validateContractTestRegistry(root, [TEST], [entry])).toEqual([entry]);
});

it('rejects a projection whose sensitivity disagrees with reference evidence', () => {
  const { root, context } = fixture({
    [TEST]: `import { readFileSync } from 'node:fs'; readFileSync(new URL('../data.json', import.meta.url));`,
    'scripts/harness/data.json': '{}',
  });
  const registry = createContractTestRegistry(root, [TEST], context);
  const forged = structuredClone(registry);
  forged[0].projectedInputs.find((input) => input.sensitivity === 'content').sensitivity =
    'name-set';
  expect(() => validateContractTestRegistry(root, [TEST], forged)).toThrow(/projection/);
});

it('rejects legacy input arrays that drop a dependency still present in typed evidence', () => {
  const { root, context } = fixture({
    [TEST]:
      "import { readFileSync } from 'node:fs'; readFileSync(new URL('../data.json', import.meta.url));",
    'scripts/harness/data.json': '{}',
  });
  const registry = structuredClone(createContractTestRegistry(root, [TEST], context));
  registry[0].repositoryInputs = [];
  registry[0].inputDomains = [];
  expect(() => validateContractTestRegistry(root, [TEST], registry)).toThrow(/projection/);
});

it('invalidates contract selection/cache control inputs when the shared evidence machinery changes', () => {
  expect(CONTRACT_CONTROL_PLANE_INPUTS).toEqual(
    expect.arrayContaining([
      'scripts/harness/workspace-source-dependencies.mjs',
      'scripts/harness/workspace-source-reference-extraction.mjs',
      'scripts/harness/workspace-source-reference-resolution.mjs',
      'scripts/harness/workspace-source-config-resolution.mjs',
      'scripts/harness/harness-test-classification.mjs',
      'scripts/harness/lib/ts-ast.mjs',
    ]),
  );
});

it('reuses emitted-source, workspace export and alias resolution with mapping evidence', () => {
  const { root, context } = fixture({
    [TEST]: `import '../helper.mjs'; import '@fixture/owner'; import '@local/value';`,
    'scripts/harness/helper.mts': 'export const helper = 1;',
    'packages/owner/package.json': JSON.stringify({
      name: '@fixture/owner',
      exports: { source: './src/index.ts' },
    }),
    'packages/owner/src/index.ts': 'export const owner = 1;',
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@local/*': ['./source/*'] } } }),
    'source/value.ts': 'export const value = 1;',
  });
  context.packages.push({ name: '@fixture/owner', directory: 'packages/owner' });
  const registry = createContractTestRegistry(root, [TEST], context);
  expect(registry[0].implementationInputs).toEqual([
    'packages/owner/src/index.ts',
    TEST,
    'scripts/harness/helper.mts',
    'source/value.ts',
  ]);
  expect(registry[0].repositoryInputs).toEqual(['packages/owner/package.json', 'tsconfig.json']);
  expect(registry[0].projectedInputs).toContainEqual({
    targetOrPattern: 'packages/owner/package.json',
    sensitivity: 'content',
    referenceIds: [expect.any(String)],
  });
  expect(validateContractTestRegistry(root, [TEST], registry)).toBe(registry);
});

it('does not read symlinked files or paths below symlinked directories even if listed', () => {
  const { root, context } = fixture({
    [TEST]: "import '../linked.mjs'; import '../linked-dir/private.mjs';",
    'scripts/harness/actual/private.mjs': "import './not-a-real-module.mjs';",
  });
  symlinkSync('actual/private.mjs', path.join(root, 'scripts/harness/linked.mjs'));
  symlinkSync('actual', path.join(root, 'scripts/harness/linked-dir'));
  context.files.add('scripts/harness/linked.mjs');
  context.files.add('scripts/harness/linked-dir/private.mjs');
  const reads = [];
  const readFile = context.readFile;
  context.readFile = (file) => {
    reads.push(file);
    return readFile(file);
  };
  const registry = createContractTestRegistry(root, [TEST], context);
  expect(reads).toEqual([TEST]);
  expect(registry[0].references.map((reference) => reference.resolution.reason)).toEqual([
    'missing-target',
    'missing-target',
  ]);
  expect(registry[0]).toMatchObject({ always: true, cacheable: false });
  expect(registry[0].uncertainInputs.map((input) => input.reason)).toEqual([
    'missing-target',
    'missing-target',
  ]);
  expect(validateContractTestRegistry(root, [TEST], registry)).toBe(registry);
});

it('defaults content reads to the repository cwd used by contract execution', () => {
  const { root, context } = fixture({
    [TEST]: "import { readFileSync } from 'node:fs'; readFileSync('input.json');",
    'input.json': '{}',
  });
  const [entry] = createContractTestRegistry(root, [TEST], context);
  expect(entry.repositoryInputs).toEqual(['input.json']);
  expect(
    entry.references.find((reference) => reference.kind === 'read-content').resolution,
  ).toMatchObject({ status: 'resolved', targets: ['input.json'] });
});

it.each([
  "import { execFileSync } from 'node:child_process'; execFileSync('./runner.mjs');",
  "import * as child from 'node:child_process'; child.execFile('./runner.mjs', []);",
  "import { execFileSync } from 'node:child_process'; execFileSync(process.execPath, ['./runner.mjs']);",
])('projects shared executable evidence and follows its actual imports: %s', (source) => {
  const { root, context } = fixture({
    [TEST]: source,
    'scripts/harness/runner.mjs': "import './dependency.mjs';",
    'scripts/harness/dependency.mjs': '',
  });
  const registry = createContractTestRegistry(root, [TEST], { ...context, cwd: 'scripts/harness' });
  expect(registry[0].implementationInputs).toEqual([
    TEST,
    'scripts/harness/dependency.mjs',
    'scripts/harness/runner.mjs',
  ]);
  const reference = registry[0].references.find((entry) => entry.kind === 'execute');
  expect(registry[0].projectedInputs).toContainEqual({
    targetOrPattern: 'scripts/harness/runner.mjs',
    sensitivity: 'execution',
    referenceIds: [reference.id],
  });
  expect(validateContractTestRegistry(root, [TEST], registry)).toBe(registry);
});

it.each([
  "execFileSync(process.execPath, ['--import', './setup.mjs', './runner.mjs']);",
  'execFileSync(command, args);',
])('keeps uncertain execution visible instead of guessing a dependency: %s', (invocation) => {
  const { root, context } = fixture({
    [TEST]: `import { execFileSync } from 'node:child_process'; ${invocation}`,
    'scripts/harness/runner.mjs': '',
  });
  const registry = createContractTestRegistry(root, [TEST], { ...context, cwd: 'scripts/harness' });
  expect(registry[0].references.find((entry) => entry.kind === 'execute').resolution.status).toBe(
    'unresolved',
  );
  expect(registry[0]).toMatchObject({ always: true, cacheable: false });
  expect(registry[0].uncertainInputs.some((input) => input.reason === 'nonliteral-reference')).toBe(
    true,
  );
  expect(validateContractTestRegistry(root, [TEST], registry)).toBe(registry);
});

it('does not resolve an executable against caller cwd when call options override that cwd', () => {
  const { root, context } = fixture({
    [TEST]: `import { execFileSync } from 'node:child_process';
      execFileSync('./runner.mjs', [], { cwd: 'another-directory' });`,
    'scripts/harness/runner.mjs': '',
  });
  const registry = createContractTestRegistry(root, [TEST], { ...context, cwd: 'scripts/harness' });
  expect(registry[0].references.find((entry) => entry.kind === 'execute').resolution.status).toBe(
    'unresolved',
  );
});
