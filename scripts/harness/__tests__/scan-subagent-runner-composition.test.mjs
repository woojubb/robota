import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findSubagentRunnerCompositionFindings } from '../scan-subagent-runner-composition.mjs';

/**
 * ARCH-021. The scan under test exists because the TOOL axis cannot be cut by a manifest edge, so it
 * is the only floor on the axis with the failure history (ARCH-010, ARCH-006). A floor that cannot
 * fail is worse than no floor, so every case here is a case that MUST go red.
 */
function createFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'arch-021-scan-'));
  const defaults = {
    'packages/agent-subagent-runner/package.json': JSON.stringify({
      name: '@robota-sdk/agent-subagent-runner',
      dependencies: { '@robota-sdk/agent-framework': 'workspace:*' },
    }),
    'packages/agent-subagent-runner/src/index.ts': 'export const ok = 1;\n',
    ...files,
  };
  for (const [relative, content] of Object.entries(defaults)) {
    const target = join(root, relative);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return root;
}

describe('findSubagentRunnerCompositionFindings', () => {
  it('passes a runner that composes nothing', () => {
    const root = createFixture({});

    const { findings, examined } = findSubagentRunnerCompositionFindings(root);

    expect(findings).toEqual([]);
    // A scan that examined nothing would also report no findings; assert it looked.
    expect(examined.files).toBeGreaterThan(0);
    expect(examined.manifests).toBe(1);
  });

  it('flags an import of createDefaultTools — the axis the manifest cannot cut', () => {
    const root = createFixture({
      'packages/agent-subagent-runner/src/worker.ts':
        "import { createDefaultTools } from '@robota-sdk/agent-framework';\nexport const t = createDefaultTools;\n",
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('packages/agent-subagent-runner/src/worker.ts');
    expect(findings[0].detail).toContain('createDefaultTools');
  });

  it('flags an import of createDefaultProviderDefinitions', () => {
    const root = createFixture({
      'packages/agent-subagent-runner/src/worker.ts':
        "import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';\nexport const p = createDefaultProviderDefinitions;\n",
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings.map((finding) => finding.detail).join(' ')).toContain(
      'createDefaultProviderDefinitions',
    );
  });

  it('flags the manifest edge independently of any import', () => {
    const root = createFixture({
      'packages/agent-subagent-runner/package.json': JSON.stringify({
        dependencies: { '@robota-sdk/agent-provider-defaults': 'workspace:*' },
      }),
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('packages/agent-subagent-runner/package.json');
  });

  it('finds a forbidden import in a nested directory, not only at the top level', () => {
    const root = createFixture({
      'packages/agent-subagent-runner/src/deep/nested/worker.ts':
        "import { createDefaultTools } from '@robota-sdk/agent-framework';\nexport const t = createDefaultTools;\n",
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings).toHaveLength(1);
  });

  it('flags a NAMESPACE import used through the alias', () => {
    // The first version of this scan missed it: its regex looked for the symbol between `import`
    // and `from`, and a namespace import never names the symbol there.
    const root = createFixture({
      'packages/agent-subagent-runner/src/worker.ts':
        "import * as fw from '@robota-sdk/agent-framework';\nexport const t = fw.createDefaultTools({ cwd: '.' });\n",
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings.map((finding) => finding.detail).join(' ')).toContain('createDefaultTools');
  });

  it('flags a DYNAMIC import destructured at the call site', () => {
    const root = createFixture({
      'packages/agent-subagent-runner/src/worker.ts':
        "export async function t() {\n  const { createDefaultTools } = await import('@robota-sdk/agent-framework');\n  return createDefaultTools({ cwd: '.' });\n}\n",
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings.map((finding) => finding.detail).join(' ')).toContain('createDefaultTools');
  });

  it('flags an ALIASED named import by the symbol it imports, not the local name', () => {
    const root = createFixture({
      'packages/agent-subagent-runner/src/worker.ts':
        "import { createDefaultTools as build } from '@robota-sdk/agent-framework';\nexport const t = build;\n",
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings).toHaveLength(1);
  });

  it('does NOT flag prose that merely names the symbols, even beside a real import', () => {
    // The guarded file's own docblock names both symbols while explaining why it must not import
    // them, and it also has legitimate imports. The first version false-flagged exactly this shape.
    const root = createFixture({
      'packages/agent-subagent-runner/src/worker.ts':
        "import { createSubagentSession } from '@robota-sdk/agent-framework';\n/**\n * ARCH-021: this file must not use createDefaultTools or createDefaultProviderDefinitions.\n */\nexport const ok = createSubagentSession;\nimport { join } from 'node:path';\nexport const j = join;\n",
    });

    const { findings } = findSubagentRunnerCompositionFindings(root);

    expect(findings).toEqual([]);
  });
});
