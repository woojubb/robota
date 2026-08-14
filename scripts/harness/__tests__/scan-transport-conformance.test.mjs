import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  discoverTransportSubjects,
  findTransportConformanceFindings,
} from '../scan-transport-conformance.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'transport-conformance-'));
  mkdirSync(path.join(root, 'packages'), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeSubject({ packageDir, packageName, exportName, kind = 'factory', invoke = true }) {
  const dir = path.join(root, 'packages', packageDir);
  mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: packageName }));
  const source =
    kind === 'class'
      ? `export class ${exportName} implements IConfigurableTransport<unknown> {}`
      : `export interface IExample extends ITransportAdapter<unknown> {}\nexport function ${exportName}(): IExample { throw new Error(); }\n`;
  writeFileSync(path.join(dir, 'src', 'index.ts'), source);
  if (invoke) {
    writeFileSync(
      path.join(dir, 'src', '__tests__', 'conformance.test.ts'),
      `runTransportLifecycleConformance({ subjectId: '${packageName}#${exportName}' });\n`,
    );
  }
}

describe('transport conformance roster', () => {
  it('discovers exported factory and class adapter subjects', () => {
    makeSubject({
      packageDir: 'agent-transport-one',
      packageName: '@scope/one',
      exportName: 'createOne',
    });
    makeSubject({
      packageDir: 'agent-transport-two',
      packageName: '@scope/two',
      exportName: 'TwoTransport',
      kind: 'class',
    });

    expect(discoverTransportSubjects(root)).toEqual([
      '@scope/one#createOne',
      '@scope/two#TwoTransport',
    ]);
  });

  it('fails an unregistered new public adapter', () => {
    makeSubject({
      packageDir: 'agent-transport-one',
      packageName: '@scope/one',
      exportName: 'createOne',
    });
    makeSubject({
      packageDir: 'agent-transport-two',
      packageName: '@scope/two',
      exportName: 'createTwo',
    });

    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toContain(
      'unregistered public subject: @scope/two#createTwo',
    );
  });

  it('fails missing and duplicate shared-suite ownership', () => {
    makeSubject({
      packageDir: 'agent-transport-one',
      packageName: '@scope/one',
      exportName: 'createOne',
      invoke: false,
    });
    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toContain(
      '@scope/one#createOne: expected exactly one shared-suite invocation, found 0',
    );

    const duplicate = path.join(
      root,
      'packages',
      'agent-transport-one',
      'src',
      '__tests__',
      'duplicate.test.ts',
    );
    writeFileSync(
      duplicate,
      "runTransportLifecycleConformance({ subjectId: '@scope/one#createOne' });\n",
    );
    const owner = duplicate.replace('duplicate.test.ts', 'owner.test.ts');
    writeFileSync(
      owner,
      "runTransportLifecycleConformance({ subjectId: '@scope/one#createOne' });\n",
    );
    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toContain(
      '@scope/one#createOne: expected exactly one shared-suite invocation, found 2',
    );
  });

  it('refuses a root without the governed packages tree', () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'transport-conformance-bare-'));
    expect(() => discoverTransportSubjects(bare)).toThrow(/packages missing from/);
    rmSync(bare, { recursive: true, force: true });
  });
});
