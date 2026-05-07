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

  it('flags command effect state stored on InteractiveSession', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/ui/hooks/useSideEffects.ts':
        'const effects = interactiveSession as InteractiveSession & ISideEffects;\neffects._pendingCommandEffects = [];\n',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/ui/hooks/useSideEffects.ts',
        type: 'cli-command-effect-session-state',
        detail:
          'CLI/TUI command effect transport must use an explicit CLI-owned queue, not ad hoc fields on InteractiveSession.',
      },
    ]);
  });

  it('flags the legacy CLI slash executor file', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/commands/slash-executor.ts':
        'switch (cmd) { case "model": return { handled: false }; }\n',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/commands/slash-executor.ts',
        type: 'cli-legacy-slash-executor',
        detail:
          'CLI must not keep a legacy built-in slash command switch; use session.executeCommand() and generic skill/plugin fallback.',
      },
    ]);
  });

  it('flags the legacy CLI plugin command source copy', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/commands/plugin-source.ts':
        'export class PluginCommandSource { getCommands() { return []; } }\n',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/commands/plugin-source.ts',
        type: 'cli-legacy-plugin-source',
        detail:
          'CLI must not keep a local PluginCommandSource copy; use the SDK-owned PluginCommandSource.',
      },
    ]);
  });

  it('flags CLI command shim surfaces', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/commands/command-registry.ts':
        'export { CommandRegistry } from "@robota-sdk/agent-sdk";\n',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/commands/command-registry.ts',
        type: 'cli-command-shim-surface',
        detail:
          'agent-cli must not expose command infrastructure under src/commands; import SDK-owned command APIs from @robota-sdk/agent-sdk.',
      },
    ]);
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

  it('flags direct CLI imports from agent-sessions', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/cli.ts':
        'import { SessionStore } from "@robota-sdk/agent-sessions";\n',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/cli.ts',
        type: 'cli-agent-sessions-import',
        detail:
          'agent-cli must not import @robota-sdk/agent-sessions; use SDK-owned session persistence APIs.',
      },
    ]);
  });

  it('flags direct CLI package dependencies on agent-sessions', async () => {
    const root = await createFixture({
      'packages/agent-cli/package.json':
        '{"dependencies":{"@robota-sdk/agent-sessions":"workspace:*"}}',
      'packages/agent-sdk/package.json': '{"dependencies":{}}',
    });

    const findings = await findCommandLayeringFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/package.json',
        type: 'cli-agent-sessions-dependency',
        detail:
          'agent-cli must not depend on @robota-sdk/agent-sessions; use @robota-sdk/agent-sdk facade APIs.',
      },
    ]);
  });
});
