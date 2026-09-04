import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { EditCheckpointStore } from '../../checkpoints/edit-checkpoint-store.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IAIProvider, IAssistantMessage, TUniversalMessage } from '@robota-sdk/agent-core';

const TMP_BASE = mkdtempSync(join(tmpdir(), 'robota-interactive-checkpoints-'));
const ORIGINAL_HOME = process.env.HOME;

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function createCheckpointStore(cwd: string): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'interactive checkpoint test',
    }),
  });
}

function assistantMessage(
  content: string,
  toolCalls?: NonNullable<IAssistantMessage['toolCalls']>,
): TUniversalMessage {
  return {
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date('2026-05-02T00:00:00.000Z'),
    ...(toolCalls ? { toolCalls, finishReason: 'tool_calls' } : {}),
  } as TUniversalMessage;
}

function createProvider(responses: TUniversalMessage[]): IAIProvider {
  return {
    name: 'mock',
    version: 'test',
    chat: vi.fn(async () => responses.shift() ?? assistantMessage('done')),
    generateResponse: vi.fn(),
    supportsTools: () => true,
    validateConfig: () => true,
  } as unknown as IAIProvider;
}

beforeEach(() => {
  const home = join(TMP_BASE, 'home');
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

// ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
describe.runIf(process.platform === 'linux')('InteractiveSession edit checkpointing', () => {
  it('Given the model edits a file When the turn completes Then a checkpoint can restore a later edit', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'example.txt');
    writeFileSync(filePath, 'initial', 'utf8');
    const provider = createProvider([
      assistantMessage('', [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'Write',
            arguments: JSON.stringify({ filePath, content: 'first edit' }),
          },
        },
      ]),
      assistantMessage('first done'),
      assistantMessage('', [
        {
          id: 'call_2',
          type: 'function',
          function: {
            name: 'Write',
            arguments: JSON.stringify({ filePath, content: 'second edit' }),
          },
        },
      ]),
      assistantMessage('second done'),
    ]);
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      permissionMode: 'acceptEdits',
      allowedTools: ['Write'],
      editCheckpointStore: await createCheckpointStore(cwd),
    });

    await session.submit('write first version');
    const [firstCheckpoint] = session.listEditCheckpoints();
    await session.submit('write second version');

    expect(readFileSync(filePath, 'utf8')).toBe('second edit');
    expect(firstCheckpoint?.fileCount).toBe(1);

    await session.restoreEditCheckpoint(firstCheckpoint!.id);

    expect(readFileSync(filePath, 'utf8')).toBe('first edit');
    // SELFHOST-007 TC-03: restore is non-destructive — later checkpoints are preserved (sibling
    // branch), so the first checkpoint remains reachable and nothing is deleted.
    expect(session.listEditCheckpoints().map((checkpoint) => checkpoint.id)).toContain(
      firstCheckpoint!.id,
    );
    expect(session.listEditCheckpoints().length).toBeGreaterThanOrEqual(2);
  });

  it('Given the model edits a file When rolling back the checkpoint Then the selected turn is reverted', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'example.txt');
    writeFileSync(filePath, 'initial', 'utf8');
    const provider = createProvider([
      assistantMessage('', [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'Write',
            arguments: JSON.stringify({ filePath, content: 'first edit' }),
          },
        },
      ]),
      assistantMessage('first done'),
    ]);
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      permissionMode: 'acceptEdits',
      allowedTools: ['Write'],
      editCheckpointStore: await createCheckpointStore(cwd),
    });

    await session.submit('write first version');
    const [firstCheckpoint] = session.listEditCheckpoints();

    expect(readFileSync(filePath, 'utf8')).toBe('first edit');

    await session.rollbackEditCheckpoint(firstCheckpoint!.id);

    expect(readFileSync(filePath, 'utf8')).toBe('initial');
    // SELFHOST-007 TC-03: rollback reverts the files but no longer deletes the checkpoints — they
    // remain on disk as a sibling branch (capability-preservation: the linear revert still works).
    expect(session.listEditCheckpoints().length).toBeGreaterThanOrEqual(1);
  });
});
