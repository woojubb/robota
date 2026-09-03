import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findBackgroundWorkspaceConformanceFindings,
  findUsedExemptions,
} from '../check-background-workspace-conformance.mjs';

async function createFixture(files) {
  const root = makeTemp('robota-background-workspace-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

const baselineFiles = {
  'packages/agent-executor/src/background-tasks/background-task-manager.ts':
    'export class BackgroundTaskManager {}\n',
  'packages/agent-framework/src/background-tasks/execution-workspace-projection.ts':
    'export function createExecutionWorkspaceSnapshot() { return { entries: [] }; }\n',
  'packages/agent-transport-tui/src/TuiInteractionChannel.ts':
    'session.getExecutionWorkspaceSnapshot(); session.on("execution_workspace_event", () => {}); session.readExecutionWorkspaceDetail("main");\n',
  'packages/agent-transport-tui/src/tui-state-manager.ts':
    'export class TuiStateManager { syncExecutionWorkspaceSnapshot() {} }\n',
  '.agents/specs/architecture-map/agent-system.md':
    '| Background workspace/read model                   | `agent-framework` + `agent-executor`              | CLI renders projections only. |\n',
  'packages/agent-cli/docs/SPEC.md':
    'Background agent task lifecycle and progress are projected by the SDK execution workspace APIs.\n',
};

describe('findBackgroundWorkspaceConformanceFindings', () => {
  it('accepts the SDK/runtime-owned workspace projection path', async () => {
    const root = await createFixture(baselineFiles);

    const findings = await findBackgroundWorkspaceConformanceFindings(root);

    expect(findings).toEqual([]);
  });

  it('flags direct CLI imports from agent-executor in non-exempt files (HARNESS-011)', async () => {
    const root = await createFixture({
      ...baselineFiles,
      'packages/agent-cli/src/background/executor-import.ts':
        'import { BackgroundTaskManager } from "@robota-sdk/agent-executor";\n',
    });

    const findings = await findBackgroundWorkspaceConformanceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/background/executor-import.ts',
        type: 'cli-agent-executor-import',
        detail:
          'agent-cli must not import agent-executor directly; consume SDK workspace projections.',
      },
    ]);
  });

  it('exempts the composition root with documented reasons (HARNESS-011)', async () => {
    const root = await createFixture({
      ...baselineFiles,
      'packages/agent-cli/src/cli.ts':
        'import { createDefaultBackgroundTaskRunners } from "@robota-sdk/agent-executor";\n',
      'packages/agent-cli/src/modes/print-mode.ts':
        'import type { IBackgroundTaskRunner } from "@robota-sdk/agent-executor";\n',
    });

    const findings = await findBackgroundWorkspaceConformanceFindings(root);
    expect(findings).toEqual([]);

    const exemptions = await findUsedExemptions(root);
    expect(exemptions).toHaveLength(2);
    for (const exemption of exemptions) {
      expect(exemption.type).toBe('cli-agent-executor-import');
      expect(exemption.reason).toContain('composition root');
    }
    expect(exemptions.map((exemption) => exemption.category).sort()).toEqual([
      'entrypoint',
      'type-only-contract',
    ]);
  });

  it('verifies the host-adapter category structurally and refuses a false claim (CLI-080)', async () => {
    const adapter = 'packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts';
    const genuine = await createFixture({
      ...baselineFiles,
      [adapter]: [
        'import { BackgroundTaskError, type ISubagentWorktreeAdapter } from "@robota-sdk/agent-executor";',
        'export class GitWorktreeIsolationAdapter implements ISubagentWorktreeAdapter {',
        '  prepare() { throw new BackgroundTaskError("runner", "x"); }',
        '}',
        '',
      ].join('\n'),
    });
    expect(await findBackgroundWorkspaceConformanceFindings(genuine)).toEqual([]);
    expect((await findUsedExemptions(genuine)).map((exemption) => exemption.category)).toEqual([
      'host-adapter',
    ]);

    // Same exempted path, but the file is not a host adapter: it imports a runtime value and
    // implements nothing. The listing alone must not admit it.
    const impostor = await createFixture({
      ...baselineFiles,
      [adapter]:
        'import { BackgroundTaskManager } from "@robota-sdk/agent-executor";\nexport const manager = new BackgroundTaskManager();\n',
    });
    const findings = await findBackgroundWorkspaceConformanceFindings(impostor);
    expect(findings.map((finding) => finding.type)).toEqual([
      'cli-agent-executor-import-category-mismatch',
    ]);
    expect(findings[0].detail).toContain('host-adapter');
    expect(await findUsedExemptions(impostor)).toEqual([]);
  });

  it('refuses an entrypoint that something in the package imports, and a type-only file with a value import (CLI-080)', async () => {
    const importedEntry = await createFixture({
      ...baselineFiles,
      'packages/agent-cli/src/cli.ts':
        'import { createDefaultBackgroundTaskRunners } from "@robota-sdk/agent-executor";\n',
      'packages/agent-cli/src/bin.ts': 'import { startCli } from "./cli.js";\n',
      'packages/agent-cli/src/other.ts': 'import { run } from "./cli.js";\n',
    });
    expect(
      (await findBackgroundWorkspaceConformanceFindings(importedEntry)).map((f) => f.type),
    ).toEqual(['cli-agent-executor-import-category-mismatch']);

    const valueInTypeOnly = await createFixture({
      ...baselineFiles,
      'packages/agent-cli/src/modes/print-mode.ts':
        'import { BackgroundTaskManager } from "@robota-sdk/agent-executor";\n',
    });
    expect(
      (await findBackgroundWorkspaceConformanceFindings(valueInTypeOnly)).map((f) => f.type),
    ).toEqual(['cli-agent-executor-import-category-mismatch']);
  });

  it('flags CLI-owned retention policy', async () => {
    const root = await createFixture({
      ...baselineFiles,
      'packages/agent-cli/src/ui/background-retention.ts':
        'export const CompletedTaskRetention = { ms: 1000 };\n',
    });

    const findings = await findBackgroundWorkspaceConformanceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/ui/background-retention.ts',
        type: 'cli-background-retention-owner',
        detail: 'agent-cli must not own retention, unread, or background grouping policy.',
      },
    ]);
  });

  it('flags missing SDK snapshot consumption in the TUI channel', async () => {
    const root = await createFixture({
      ...baselineFiles,
      'packages/agent-transport-tui/src/TuiInteractionChannel.ts':
        'session.getFullHistory(); session.readExecutionWorkspaceDetail("main");\n',
    });

    const findings = await findBackgroundWorkspaceConformanceFindings(root);

    expect(findings.map((finding) => finding.type)).toEqual([
      'missing-cli-sdk-snapshot-consumption',
      'missing-cli-sdk-workspace-event-consumption',
    ]);
  });
});
