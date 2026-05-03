import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findCommandLayeringFindings } from '../check-command-layering.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-command-layering-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findCommandLayeringFindings', () => {
  it('flags provider command state in CLI/TUI hooks', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/ui/hooks/useSideEffects.ts':
        'const _pendingProviderSetup = { type: "openai" };\n',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/ui/hooks/useSideEffects.ts',
        type: 'cli-provider-command-state',
        detail:
          'CLI/TUI hooks must not own provider command state; use generic ICommandInteraction/effects.',
      },
    ]);
  });

  it('flags command-specific branches in the slash router', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/ui/hooks/useSlashRouting.ts':
        'if (cmd === "provider") return routeProviderCommand();\n',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings.map((finding) => finding.type)).toContain('cli-command-specific-router-branch');
  });

  it('flags agent-sdk dependencies on command implementation packages', async () => {
    const root = await createFixture({
      'packages/agent-sdk/package.json':
        '{"dependencies":{"@robota-sdk/agent-command-provider":"workspace:*"}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-sdk/package.json',
        type: 'sdk-command-package-dependency',
        detail:
          'agent-sdk must not depend on command implementation package @robota-sdk/agent-command-provider.',
      },
    ]);
  });
});
