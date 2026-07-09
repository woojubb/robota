import { describe, expect, it } from 'vitest';

import { findEntryPointOnlyViolations } from '../check-entry-point-only.mjs';

const ROOT = '/repo';

function pkg(name, dir, files) {
  return {
    dir: `${ROOT}/${dir}`,
    name,
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
  };
}

describe('findEntryPointOnlyViolations (ARCH-PROVIDER-004)', () => {
  it('flags a non-sanctioned mid-layer package that STATICALLY imports the aggregator', () => {
    const v = findEntryPointOnlyViolations([
      pkg('@robota-sdk/dag-framework', 'packages/dag-framework', {
        'src/x.ts':
          "import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v.length).toBe(1);
    expect(v[0].package).toBe('@robota-sdk/dag-framework');
    expect(v[0].aggregator).toBe('@robota-sdk/dag-nodes-default');
  });

  it('does NOT flag a DYNAMIC import (the sanctioned framework seam)', () => {
    const v = findEntryPointOnlyViolations([
      pkg('@robota-sdk/dag-framework', 'packages/dag-framework', {
        'src/x.ts': "const m = await import('@robota-sdk/dag-nodes-default');",
      }),
    ]);
    expect(v).toEqual([]);
  });

  it('does NOT flag sanctioned composition roots', () => {
    const v = findEntryPointOnlyViolations([
      pkg('@robota-sdk/dag-cli', 'packages/dag-cli', {
        'src/r.ts':
          "import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';",
      }),
      pkg('@robota-sdk/agent-command-workflows', 'packages/agent-command-workflows', {
        'src/c.ts':
          "import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v).toEqual([]);
  });

  it('does NOT flag apps (always entry points)', () => {
    const v = findEntryPointOnlyViolations([
      pkg('@robota-sdk/dag-runtime-server', 'apps/dag-runtime-server', {
        'src/server.ts':
          "import { createDefaultNodeRegistry } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v).toEqual([]);
  });

  it('excludes the aggregator package itself', () => {
    const v = findEntryPointOnlyViolations([
      pkg('@robota-sdk/dag-nodes-default', 'packages/dag-nodes-default', {
        'src/index.ts': "export { x } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v).toEqual([]);
  });
});
