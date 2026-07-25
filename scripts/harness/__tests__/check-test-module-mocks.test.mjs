import { describe, expect, it } from 'vitest';

import {
  extractMockCall,
  findHardcodedModuleMocks,
  findStaleAllowlistEntries,
  spreadsOriginalModule,
} from '../check-test-module-mocks.mjs';

describe('findHardcodedModuleMocks', () => {
  it('flags a hardcoded workspace-module factory', () => {
    const content = [
      "vi.mock('@robota-sdk/agent-core', () => ({",
      '  SilentLogger: stub,',
      '}));',
    ].join('\n');
    const findings = findHardcodedModuleMocks(content);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ module: '@robota-sdk/agent-core', line: 1 });
  });

  it('accepts a partial mock that spreads importOriginal', () => {
    const content = [
      "vi.mock('@robota-sdk/agent-core', async (importOriginal) => ({",
      '  ...(await importOriginal()),',
      '  SilentLogger: stub,',
      '}));',
    ].join('\n');
    expect(findHardcodedModuleMocks(content)).toHaveLength(0);
  });

  it('ignores mocks of non-workspace modules and relative paths', () => {
    const content = [
      "vi.mock('node:fs', () => ({ readFileSync: stub }));",
      "vi.mock('../runner-dispatch.js', () => ({ dispatch: stub }));",
    ].join('\n');
    expect(findHardcodedModuleMocks(content)).toHaveLength(0);
  });

  it('honors the same-line allow-module-mock escape', () => {
    const content =
      "vi.mock('@robota-sdk/agent-core', () => ({ x: 1 })); // allow-module-mock: deliberate full isolation";
    expect(findHardcodedModuleMocks(content)).toHaveLength(0);
  });

  it('ignores vi.mock without a factory (auto-mock form)', () => {
    expect(findHardcodedModuleMocks("vi.mock('@robota-sdk/agent-core');")).toHaveLength(0);
  });

  // HARNESS-025: the two detection gaps that made 20 already-correct files look like violations.
  it('accepts a partial mock that spreads vi.importActual', () => {
    const content = [
      "vi.mock('@robota-sdk/agent-core', async () => {",
      "  const actual = await vi.importActual('@robota-sdk/agent-core');",
      '  return { ...actual, SilentLogger: stub };',
      '});',
    ].join('\n');
    expect(findHardcodedModuleMocks(content)).toHaveLength(0);
  });

  it('accepts a partial mock whose spread sits far past the call site', () => {
    const content = [
      "vi.mock('@robota-sdk/agent-core', async (importOriginal) => {",
      '  const mod = await importOriginal();',
      // A long factory body: the spread below used to fall outside the old 600-char window.
      ...Array.from({ length: 40 }, (_, i) => `  const filler${i} = 'xxxxxxxxxxxxxxxxxxxxxxxx';`),
      '  return { ...mod, SilentLogger: stub };',
      '});',
    ].join('\n');
    expect(findHardcodedModuleMocks(content)).toHaveLength(0);
  });

  it('flags a factory that loads the original but never spreads it', () => {
    const content = [
      "vi.mock('@robota-sdk/agent-core', async () => {",
      "  const actual = await vi.importActual('@robota-sdk/agent-core');",
      '  return { SilentLogger: actual.SilentLogger };',
      '});',
    ].join('\n');
    const findings = findHardcodedModuleMocks(content);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ module: '@robota-sdk/agent-core' });
  });
});

describe('extractMockCall', () => {
  it('returns the whole call, stopping at its balanced closing paren', () => {
    const content = "vi.mock('@robota-sdk/x', () => ({ a: f(1) }));\nconst after = 1;";
    // The nested `f(1)` must not close the call early, and the slice ends at the call's own `)`.
    expect(extractMockCall(content, 0)).toBe("vi.mock('@robota-sdk/x', () => ({ a: f(1) }))");
  });

  it('does not let a paren inside a string or comment unbalance the scan', () => {
    const content = [
      "vi.mock('@robota-sdk/x', async (importOriginal) => ({",
      '  ...(await importOriginal()),',
      "  label: 'a ) not a real paren',",
      '  // ) neither is this',
      '}));',
      'const after = 1;',
    ].join('\n');
    const call = extractMockCall(content, 0);
    expect(call.endsWith('}))')).toBe(true);
    expect(call).toContain('not a real paren');
    expect(call).not.toContain('const after');
  });
});

describe('spreadsOriginalModule', () => {
  it('accepts an inline spread of importOriginal', () => {
    expect(spreadsOriginalModule('...(await importOriginal()),')).toBe(true);
  });

  it('accepts a spread of an identifier bound from vi.importActual', () => {
    const factory = "const mod = await vi.importActual('@robota-sdk/x');\nreturn { ...mod };";
    expect(spreadsOriginalModule(factory)).toBe(true);
  });

  it('rejects a factory that never loads the original at all', () => {
    expect(spreadsOriginalModule('() => ({ SilentLogger: stub })')).toBe(false);
  });

  it('rejects a spread of some unrelated object', () => {
    const factory =
      "const actual = await vi.importActual('@robota-sdk/x');\nreturn { ...defaults, a: actual.a };";
    expect(spreadsOriginalModule(factory)).toBe(false);
  });
});

// HARNESS-025: the allowlist must only ever shrink, or the burn-down count lies.
describe('findStaleAllowlistEntries', () => {
  it('keeps an entry whose file still violates', () => {
    const violations = new Map([['a.test.ts', [{ module: '@robota-sdk/x', line: 1 }]]]);
    expect(findStaleAllowlistEntries(['a.test.ts'], violations)).toEqual([]);
  });

  it('flags an entry whose file is now clean', () => {
    const violations = new Map([['a.test.ts', []]]);
    expect(findStaleAllowlistEntries(['a.test.ts'], violations)).toEqual(['a.test.ts']);
  });

  it('flags an entry whose file no longer exists', () => {
    expect(findStaleAllowlistEntries(['gone.test.ts'], new Map())).toEqual(['gone.test.ts']);
  });

  it('reports stale entries sorted, and only the stale ones', () => {
    const violations = new Map([
      ['z.test.ts', []],
      ['a.test.ts', []],
      ['keep.test.ts', [{ module: '@robota-sdk/x', line: 1 }]],
    ]);
    expect(
      findStaleAllowlistEntries(['z.test.ts', 'keep.test.ts', 'a.test.ts'], violations),
    ).toEqual(['a.test.ts', 'z.test.ts']);
  });
});
