import { describe, expect, it } from 'vitest';

import { findHardcodedModuleMocks } from '../check-test-module-mocks.mjs';

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
});
