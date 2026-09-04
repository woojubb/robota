import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { EditCheckpointStore, createWorkspaceProjectMutation } from '@robota-sdk/agent-framework';

import { createSessionEventRenderingProjectAccess } from './session-event-rendering-project-access.js';
import { TuiInteractionChannel } from '../src/index.js';

// Contained — ARCH-047. Project mutation (the Write tool that produces edit checkpoints) is
// available only on Linux (project-relative-writer.ts refuses other hosts by design), so this
// scenario cannot run here. It says so explicitly instead of failing on a refusal it cannot influence.
if (process.platform !== 'linux') {
  console.log(
    JSON.stringify({
      notApplicable: true,
      reason: 'ARCH-047: project mutation is Linux-only; checkpoint scenario skipped on this host',
      platform: process.platform,
    }),
  );
  process.exit(0);
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-028-tui-'));
  const agentsPath = join(cwd, 'AGENTS.md');
  writeFileSync(agentsPath, '# Initial rules\n', 'utf8');
  const script = createScriptedProvider([{ text: 'context refreshed' }]);
  const projectAccess = await createSessionEventRenderingProjectAccess(cwd);
  assertCondition(projectAccess.status === 'trusted', 'scenario project access was not trusted');
  const editCheckpointStore = new EditCheckpointStore({
    authority: projectAccess.authority,
    mutation: createWorkspaceProjectMutation(projectAccess.authority, {
      status: 'approved',
      purpose: 'render checkpoint lifecycle events in the TUI scenario',
    }),
  });
  const deliveryFailures: Array<{ message: string; event: string }> = [];
  const channel = new TuiInteractionChannel({
    cwd,
    provider: script.provider,
    projectAccess,
    editCheckpointStore,
    sessionName: 'ARCH-028 scenario',
    permissionMode: 'acceptEdits',
    onSessionEventDeliveryError: (error, event) =>
      deliveryFailures.push({ message: error.message, event }),
  });
  let result: Record<string, unknown> | undefined;

  try {
    await channel.start();
    const session = channel.getSession();
    await session.setPlan('Render session events', ['project']);
    session.approvePlan();
    writeFileSync(agentsPath, '# Refreshed rules\n', 'utf8');
    const handle = await session.submit('refresh context and create a checkpoint');
    await handle.completed;

    const originalAdd = channel.stateManager.addSessionEventNotice.bind(channel.stateManager);
    channel.stateManager.addSessionEventNotice = () => {
      throw new Error('forced TUI render projection failure');
    };
    session.revertPlan();
    channel.stateManager.addSessionEventNotice = originalAdd;

    const notices = channel.stateManager.sessionEventNotices.map((notice) => notice.message);
    assertCondition(notices.includes('Plan plan created'), 'plan_created notice was not rendered');
    assertCondition(
      notices.includes('Plan plan approved'),
      'plan_approved notice was not rendered',
    );
    assertCondition(
      notices.includes('Context refreshed: AGENTS.md'),
      'context refresh notice was not rendered',
    );
    assertCondition(
      notices.some((notice) => notice.startsWith('Branch checkpoint created:')),
      'checkpoint notice was not rendered',
    );
    assertCondition(
      deliveryFailures.length === 1 && deliveryFailures[0]?.event === 'plan_event',
      'forced render failure did not reach the TUI owner callback',
    );
    assertCondition(session.getPlanState()?.phase === 'planning', 'plan revert was not committed');

    result = {
      scenario: 'ARCH-028-tui',
      notices: notices.map((notice) => notice.replace(cwd, '<cwd>')),
      deliveryFailure: {
        ...deliveryFailures[0],
        operationCommitted: session.getPlanState()?.phase === 'planning',
      },
    };
  } finally {
    await channel.stop();
    rmSync(cwd, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(cwd), 'scenario cleanup did not remove its temporary directory');
  process.stdout.write(`${JSON.stringify({ ...result, cleanupRemoved: true })}\n`);
}

await main();
