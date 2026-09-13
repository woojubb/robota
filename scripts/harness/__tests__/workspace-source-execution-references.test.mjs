import { expect, it } from 'vitest';

import { extractSourceReferences } from '../workspace-source-reference-extraction.mjs';
import { resolveSourceReference } from '../workspace-source-reference-resolution.mjs';

it('records an imported execFile call as executable input, not an arbitrary quoted filename', () => {
  const references = extractSourceReferences(
    [
      "import { execFileSync as run } from 'node:child_process';",
      "run('./scripts/check.mjs', []);",
      "const documentation = './scripts/unrelated.mjs';",
    ].join('\n'),
  );
  expect(references.filter((reference) => reference.kind === 'execute')).toMatchObject([
    { specifier: './scripts/check.mjs', anchor: 'cwd' },
  ]);
});

it('records the script supplied directly to the Node executable', () => {
  const references = extractSourceReferences(
    [
      "import { execFileSync } from 'node:child_process';",
      "execFileSync(process.execPath, ['./scripts/check.mjs']);",
    ].join('\n'),
  );
  expect(references.filter((reference) => reference.kind === 'execute')).toMatchObject([
    { specifier: './scripts/check.mjs', anchor: 'cwd' },
  ]);
});

it('retains a literal execution cwd separately from the executable and caller context', () => {
  for (const invocation of [
    "execFileSync('./runner.mjs', [], { cwd: 'another-directory' });",
    "execFileSync('./runner.mjs', { cwd: 'another-directory' });",
    "execFileSync(process.execPath, ['./runner.mjs'], { 'cwd': `another-directory` });",
  ]) {
    const source = `import { execFileSync } from 'node:child_process'; ${invocation}`;
    const reference = extractSourceReferences(source).find((entry) => entry.kind === 'execute');
    expect(reference).toMatchObject({
      specifier: './runner.mjs',
      anchor: 'cwd',
      executionCwd: { specifier: 'another-directory' },
    });
    const cwd = reference.executionCwd;
    expect(source.slice(cwd.span.start, cwd.span.end).trim()).toBe(cwd.expression);
  }
});

it.each([
  '{ cwd: process.cwd() }',
  '{ cwd }',
  'options',
  "{ cwd: 'known', ...options }",
  "{ ['cwd']: selected }",
  "{ cwd: 'first', cwd: selected }",
])('retains uncertain cwd options without a fabricated literal: %s', (options) => {
  const source = `import { execFileSync } from 'node:child_process'; execFileSync('./runner.mjs', [], ${options});`;
  const reference = extractSourceReferences(source).find((entry) => entry.kind === 'execute');
  expect(reference.executionCwd).toBeDefined();
  expect(reference.executionCwd.specifier).toBeUndefined();
  expect(
    source.slice(reference.executionCwd.span.start, reference.executionCwd.span.end).trim(),
  ).toBe(reference.executionCwd.expression);
});

it('resolves only a literal execution cwd with an explicit repository-relative caller context', () => {
  const context = {
    files: new Set(['scripts/runner.mjs', 'scripts/child/runner.mjs']),
    packages: [],
    readFile: () => '',
  };
  const execution = (cwd) =>
    extractSourceReferences(
      `import { execFileSync } from 'node:child_process'; execFileSync('./runner.mjs', [], { cwd: ${cwd} });`,
      'scripts/harness/example.test.mjs',
    ).find((entry) => entry.kind === 'execute');
  expect(
    resolveSourceReference(execution("'child'"), { ...context, cwd: 'scripts' }).resolution,
  ).toMatchObject({ status: 'resolved', targets: ['scripts/child/runner.mjs'] });
  expect(resolveSourceReference(execution("'child'"), context).resolution.status).toBe(
    'unresolved',
  );
  expect(
    resolveSourceReference(execution('process.cwd()'), { ...context, cwd: 'scripts' }).resolution
      .status,
  ).toBe('unresolved');
});
