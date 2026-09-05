import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  discoverTransportSubjects,
  findTransportConformanceFindings,
  readExaminedTransportCount,
} from '../scan-transport-conformance.mjs';
import { loadHarnessConfig } from '../harness-config.mjs';

let root;
const SCOPE = loadHarnessConfig().npmScopePrefix;

beforeEach(() => {
  root = makeTemp('transport-conformance-');
  mkdirSync(path.join(root, 'packages'), { recursive: true });
  const harnessDir = path.join(root, 'scripts', 'harness');
  mkdirSync(harnessDir, { recursive: true });
  writeFileSync(
    path.join(harnessDir, 'transport-conformance.tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        customConditions: ['source'],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: [
        '../../packages/agent-framework/src/index.ts',
        '../../packages/agent-framework/src/transport-host/**/*.ts',
        '../../packages/agent-interface-transport/src/**/*.ts',
        '../../packages/agent-transport*/src/**/*.ts',
      ],
    }),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeManifestOnly(packageDir, packageName, exports) {
  const dir = path.join(root, 'packages', packageDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: packageName, exports }));
}

function makeSubject({ packageDir, packageName, exportName, kind = 'factory', invoke = true }) {
  const dir = path.join(root, 'packages', packageDir);
  mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: packageName, exports: { '.': { source: './src/index.ts' } } }),
  );
  const contract = `
interface IExample {
  readonly name: string;
  readonly lifecycle: Readonly<{ readonly kind: 'service' }>;
  attach(session: unknown): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
const value: IExample = {} as IExample;
`;
  const source = `${contract}${
    kind === 'class'
      ? `export class ${exportName} implements IExample { readonly name='x'; readonly lifecycle={kind:'service'} as const; attach(){} async start(){} async stop(){} }`
      : kind === 'arrow'
        ? `export const ${exportName} = (): IExample => value;`
        : `export function ${exportName}(): IExample { return value; }`
  }\n`;
  writeFileSync(path.join(dir, 'src', 'index.ts'), source);
  if (invoke) {
    writeFileSync(
      path.join(dir, 'src', '__tests__', 'conformance.test.ts'),
      `import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';\nrunTransportLifecycleConformance({ subjectId: '${packageName}#${exportName}' });\n`,
    );
  }
}

function makeBarrelReExportSubject({ packageDir, packageName, exportName, invoke = true }) {
  const dir = path.join(root, 'packages', packageDir);
  mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: packageName, exports: { '.': { source: './src/index.ts' } } }),
  );
  writeFileSync(
    path.join(dir, 'src', 'adapter.ts'),
    `interface IExample {
  readonly name: string;
  readonly lifecycle: Readonly<{ readonly kind: 'service' }>;
  attach(session: unknown): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
const value: IExample = {} as IExample;
export function ${exportName}(): IExample { return value; }
`,
  );
  writeFileSync(
    path.join(dir, 'src', 'index.ts'),
    `export { ${exportName} } from './adapter.js';\n`,
  );
  if (invoke) {
    writeFileSync(
      path.join(dir, 'src', '__tests__', 'conformance.test.ts'),
      `import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';\nrunTransportLifecycleConformance({ subjectId: '${packageName}#${exportName}' });\n`,
    );
  }
}

function makeSourceConditionContract() {
  const contractDir = path.join(root, 'packages', 'agent-interface-transport');
  mkdirSync(path.join(contractDir, 'src'), { recursive: true });
  writeFileSync(
    path.join(contractDir, 'package.json'),
    JSON.stringify({
      name: '@scope/contracts',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          source: './src/index.ts',
          default: './dist/index.js',
        },
      },
    }),
  );
  writeFileSync(
    path.join(contractDir, 'src', 'index.ts'),
    `export interface IAdapter {
  readonly name: string;
  readonly lifecycle: Readonly<{ readonly kind: 'service' }>;
  attach(session: unknown): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}\n`,
  );
  const scopeDir = path.join(root, 'node_modules', '@scope');
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(contractDir, path.join(scopeDir, 'contracts'), 'dir');
}

describe('transport conformance roster', () => {
  it('discovers the framework-owned host through its root and its moved shared suite', () => {
    makeBarrelReExportSubject({
      packageDir: 'agent-framework',
      packageName: '@scope/framework',
      exportName: 'createHeadlessTransport',
    });
    const src = path.join(root, 'packages', 'agent-framework', 'src');
    const host = path.join(src, 'transport-host');
    mkdirSync(host, { recursive: true });
    renameSync(path.join(src, 'adapter.ts'), path.join(host, 'adapter.ts'));
    renameSync(path.join(src, '__tests__'), path.join(host, '__tests__'));
    writeFileSync(
      path.join(src, 'index.ts'),
      "export { createHeadlessTransport } from './transport-host/adapter.js';\n",
    );
    // Another framework adapter-shaped factory is not a transport-host subject.
    writeFileSync(
      path.join(src, 'unrelated.ts'),
      readFileSync(path.join(host, 'adapter.ts'), 'utf8').replaceAll(
        'createHeadlessTransport',
        'createUnrelated',
      ),
    );
    writeFileSync(
      path.join(src, 'index.ts'),
      "export { createHeadlessTransport } from './transport-host/adapter.js';\nexport { createUnrelated } from './unrelated.js';\n",
    );
    const subjects = ['@scope/framework#createHeadlessTransport'];
    expect(findTransportConformanceFindings(root, subjects)).toEqual([]);
    expect(readExaminedTransportCount()).toBe(1);
    rmSync(path.join(host, '__tests__', 'conformance.test.ts'));
    expect(findTransportConformanceFindings(root, subjects)).toContain(
      '@scope/framework#createHeadlessTransport: expected exactly one shared-suite invocation, found 0',
    );
    writeFileSync(
      path.join(host, 'adapter.ts'),
      'export function createHeadlessTransport() { return {}; }\n',
    );
    expect(findTransportConformanceFindings(root, subjects)).toContain(
      'missing public subject: @scope/framework#createHeadlessTransport',
    );
  });

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

    expect(
      findTransportConformanceFindings(root, ['@scope/one#createOne', '@scope/two#TwoTransport']),
    ).toEqual([]);
    expect(readExaminedTransportCount()).toBe(2);

    expect(
      findTransportConformanceFindings(root, ['@scope/one#createOne', '@scope/two#TwoTransport']),
    ).toEqual([]);
    expect(readExaminedTransportCount()).toBe(2);
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

  it('discovers arrow factories and barrel exports through package export entries', () => {
    makeSubject({
      packageDir: 'agent-transport-one',
      packageName: '@scope/one',
      exportName: 'createOne',
      kind: 'arrow',
    });
    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toEqual([]);
  });

  it('discovers barrel re-exported factories when alias declarations are unavailable', () => {
    makeBarrelReExportSubject({
      packageDir: 'agent-transport-one',
      packageName: '@scope/one',
      exportName: 'createOne',
    });

    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toEqual([]);
  });

  it('discovers a factory through workspace source exports without built declarations', () => {
    makeSourceConditionContract();
    const dir = path.join(root, 'packages', 'agent-transport-one');
    mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: '@scope/one',
        exports: { '.': { source: './src/index.ts', types: './dist/index.d.ts' } },
      }),
    );
    writeFileSync(
      path.join(dir, 'src', 'transport.ts'),
      `import type { IAdapter } from '@scope/contracts';
export interface IOneTransport extends IAdapter {}
declare const value: IOneTransport;
export function createOne(): IOneTransport { return value; }\n`,
    );
    writeFileSync(
      path.join(dir, 'src', 'index.ts'),
      "export { createOne } from './transport.js';\n",
    );
    writeFileSync(
      path.join(dir, 'src', '__tests__', 'conformance.test.ts'),
      "import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';\nrunTransportLifecycleConformance({ subjectId: '@scope/one#createOne' });\n",
    );

    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toEqual([]);
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
      "import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';\nrunTransportLifecycleConformance({ subjectId: '@scope/one#createOne' });\n",
    );
    const owner = duplicate.replace('duplicate.test.ts', 'owner.test.ts');
    writeFileSync(
      owner,
      "import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';\nrunTransportLifecycleConformance({ subjectId: '@scope/one#createOne' });\n",
    );
    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toContain(
      '@scope/one#createOne: expected exactly one shared-suite invocation, found 2',
    );
  });

  it('does not accept comments or unrelated helper mentions as suite ownership', () => {
    makeSubject({
      packageDir: 'agent-transport-one',
      packageName: '@scope/one',
      exportName: 'createOne',
      invoke: false,
    });
    const fake = path.join(
      root,
      'packages',
      'agent-transport-one',
      'src',
      '__tests__',
      'fake.test.ts',
    );
    writeFileSync(
      fake,
      "// runTransportLifecycleConformance({ subjectId: '@scope/one#createOne' });\nconst note = 'runTransportLifecycleConformance';\n",
    );
    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toContain(
      '@scope/one#createOne: expected exactly one shared-suite invocation, found 0',
    );
  });

  it('does not accept a same-named helper imported from another module', () => {
    makeSubject({
      packageDir: 'agent-transport-one',
      packageName: '@scope/one',
      exportName: 'createOne',
      invoke: false,
    });
    const fake = path.join(
      root,
      'packages',
      'agent-transport-one',
      'src',
      '__tests__',
      'fake-import.test.ts',
    );
    writeFileSync(
      fake,
      "import { runTransportLifecycleConformance } from 'untrusted-helper';\nrunTransportLifecycleConformance({ subjectId: '@scope/one#createOne' });\n",
    );
    expect(findTransportConformanceFindings(root, ['@scope/one#createOne'])).toContain(
      '@scope/one#createOne: expected exactly one shared-suite invocation, found 0',
    );
  });

  it('fails closed when a transport package omits or breaks its source export', () => {
    makeManifestOnly('agent-transport-one', '@scope/one', { '.': './dist/index.js' });
    expect(() => discoverTransportSubjects(root)).toThrow(/declare no source entry/);

    rmSync(path.join(root, 'packages', 'agent-transport-one'), { recursive: true, force: true });
    makeManifestOnly('agent-transport-two', '@scope/two', {
      '.': { source: './src/missing.ts' },
    });
    expect(() => discoverTransportSubjects(root)).toThrow(/source export does not exist/);
  });

  it('scans the conventional source entry of a dist-only presentation package', () => {
    makeManifestOnly('agent-transport-gui', `${SCOPE}agent-transport-gui`, {
      '.': './dist/index.js',
    });
    const sourceDir = path.join(root, 'packages', 'agent-transport-gui', 'src');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      path.join(sourceDir, 'index.ts'),
      `interface IAdapter { readonly name: string; readonly lifecycle: Readonly<{ readonly kind: 'service' }>; attach(session: unknown): void; start(): Promise<void>; stop(): Promise<void> }
export const createPresentationTransport = (): IAdapter => ({} as IAdapter);\n`,
    );

    expect(discoverTransportSubjects(root)).toEqual([
      `${SCOPE}agent-transport-gui#createPresentationTransport`,
    ]);
  });

  it('refuses a root without the governed packages tree', () => {
    const bare = makeTemp('transport-conformance-bare-');
    expect(() => discoverTransportSubjects(bare)).toThrow(/packages missing from/);
    rmSync(bare, { recursive: true, force: true });
  });
});
