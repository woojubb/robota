import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore, InteractiveSession } from '@robota-sdk/agent-framework';
import { createOutboundDelivery, createWsHandler } from '@robota-sdk/agent-transport-protocol';

import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function completeTurn(session: InteractiveSession, prompt: string): Promise<void> {
  const handle = await session.submit(prompt);
  await handle.completed;
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-020-028-protocol-'));
  const agentsPath = join(cwd, 'AGENTS.md');
  const editPath = join(cwd, 'event-delivery.txt');
  writeFileSync(agentsPath, '# Initial rules\n', 'utf8');
  const script = createScriptedProvider([
    {
      toolCalls: [{ name: 'Write', args: { filePath: editPath, content: 'first checkpoint' } }],
    },
    { text: 'first complete' },
    {
      toolCalls: [{ name: 'Write', args: { filePath: editPath, content: 'second checkpoint' } }],
    },
    { text: 'second complete' },
  ]);
  const store = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'));
  const session = new InteractiveSession({
    cwd,
    provider: script.provider,
    sessionStore: store,
    permissionMode: 'acceptEdits',
    allowedTools: ['Write'],
  });
  const transcript: TServerMessage[] = [];
  const deliveryErrors: Array<{ message: string; event: string }> = [];
  const primary = createWsHandler({
    session,
    deliver: createOutboundDelivery(
      (message) => transcript.push(message),
      (error, event) => deliveryErrors.push({ message: error.message, event }),
    ),
  });
  let failureCleanup: (() => void) | undefined;
  let result: Record<string, unknown> | undefined;

  try {
    await session.setPlan('Deliver session events', ['emit', 'forward', 'render']);
    session.approvePlan();
    writeFileSync(agentsPath, '# Refreshed rules\n', 'utf8');
    await completeTurn(session, 'create first checkpoint');
    await completeTurn(session, 'create second checkpoint');
    const [first, second] = session.listEditCheckpoints();
    assertCondition(first !== undefined && second !== undefined, 'expected two checkpoints');

    const forcedFailures: Array<{ message: string; event: string }> = [];
    const failureCarrier = createWsHandler({
      session,
      deliver: createOutboundDelivery(
        (message) => {
          if (message.type === 'branch_event') throw new Error('forced protocol send failure');
        },
        (error, event) => forcedFailures.push({ message: error.message, event }),
      ),
    });
    failureCleanup = failureCarrier.cleanup;
    await session.forkCheckpointBranch(first.id);
    const forkRecord = store.load(session.getSession().getSessionId());
    const forkFrame = transcript.findLast(
      (message) => message.type === 'branch_event' && message.event.kind === 'branch_forked',
    );
    const operationCommitted =
      forkFrame?.type === 'branch_event' &&
      forkRecord?.activeBranch?.checkpointId === forkFrame.event.checkpointId &&
      forkRecord.activeBranch.branchId === forkFrame.event.branchId;
    failureCleanup();
    failureCleanup = undefined;

    session.switchCheckpointBranch(second.id);
    const finalRecord = store.load(session.getSession().getSessionId());
    const branchFrames = transcript.filter(
      (message): message is Extract<TServerMessage, { type: 'branch_event' }> =>
        message.type === 'branch_event',
    );
    const planFrames = transcript.filter(
      (message): message is Extract<TServerMessage, { type: 'plan_event' }> =>
        message.type === 'plan_event',
    );
    const contextFrames = transcript.filter(
      (message): message is Extract<TServerMessage, { type: 'context_file_refreshed' }> =>
        message.type === 'context_file_refreshed',
    );

    assertCondition(
      planFrames.map((frame) => frame.event.type).join(',') === 'plan_created,plan_approved',
      'plan lifecycle did not reach the protocol client',
    );
    assertCondition(
      contextFrames.length === 1,
      'context refresh did not reach the protocol client',
    );
    assertCondition(
      branchFrames.some((frame) => frame.event.kind === 'checkpoint_created') &&
        branchFrames.some((frame) => frame.event.kind === 'branch_forked') &&
        branchFrames.some((frame) => frame.event.kind === 'branch_switched'),
      'branch lifecycle was incomplete',
    );
    assertCondition(
      forcedFailures.length === 1,
      'forced send failure was not reported exactly once',
    );
    assertCondition(operationCommitted, 'fork was not committed before delivery failed');
    const lastBranch = branchFrames.at(-1)?.event;
    assertCondition(
      lastBranch?.kind === 'branch_switched' &&
        finalRecord?.activeBranch?.checkpointId === lastBranch.checkpointId &&
        finalRecord.activeBranch.branchId === lastBranch.branchId,
      'persisted active branch did not match the last successful operation',
    );
    assertCondition(deliveryErrors.length === 0, 'primary protocol delivery failed');

    result = {
      scenario: 'ARCH-020+ARCH-028-protocol',
      planEvents: planFrames.map((frame) => frame.event.type),
      contextRefreshFiles: contextFrames.map((frame) => frame.event.filePath.replace(cwd, '<cwd>')),
      branchEvents: branchFrames.map((frame) => ({
        kind: frame.event.kind,
        checkpointId: frame.event.checkpointId,
        branchId: frame.event.branchId,
      })),
      finalActiveBranch: finalRecord.activeBranch,
      deliveryFailure: { ...forcedFailures[0], operationCommitted },
    };
  } finally {
    failureCleanup?.();
    primary.cleanup();
    await session.shutdown();
    rmSync(cwd, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(cwd), 'scenario cleanup did not remove its temporary directory');
  process.stdout.write(`${JSON.stringify({ ...result, cleanupRemoved: true })}\n`);
}

await main();
