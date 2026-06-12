import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findBackgroundWorkspaceConformanceFindings } from '../check-background-workspace-conformance.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-background-workspace-'));
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
  'packages/agent-transport/src/tui/TuiInteractionChannel.ts':
    'session.getExecutionWorkspaceSnapshot(); session.on("execution_workspace_event", () => {}); session.readExecutionWorkspaceDetail("main");\n',
  'packages/agent-transport/src/tui/tui-state-manager.ts':
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

  it('flags direct CLI imports from agent-runtime', async () => {
    // The rule's pattern still targets the legacy '@robota-sdk/agent-runtime' name and is
    // therefore dead against current '@robota-sdk/agent-executor' imports — reviving it
    // requires an architecture decision on the CLI composition root's two real
    // agent-executor imports (tracked in HARNESS-011). This test pins the implemented
    // behavior so the rule's revival is a deliberate change, not an accident.
    const root = await createFixture({
      ...baselineFiles,
      'packages/agent-cli/src/background/runtime-import.ts':
        'import { BackgroundTaskManager } from "@robota-sdk/agent-runtime";\n',
    });

    const findings = await findBackgroundWorkspaceConformanceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/background/runtime-import.ts',
        type: 'cli-agent-runtime-import',
        detail:
          'agent-cli must not import agent-executor directly; consume SDK workspace projections.',
      },
    ]);
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
      'packages/agent-transport/src/tui/TuiInteractionChannel.ts':
        'session.getFullHistory(); session.readExecutionWorkspaceDetail("main");\n',
    });

    const findings = await findBackgroundWorkspaceConformanceFindings(root);

    expect(findings.map((finding) => finding.type)).toEqual([
      'missing-cli-sdk-snapshot-consumption',
      'missing-cli-sdk-workspace-event-consumption',
    ]);
  });
});
