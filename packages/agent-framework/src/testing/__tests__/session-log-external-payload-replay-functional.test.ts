import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReplayProviderFromSource } from '@robota-sdk/agent-provider-replay';
import { NodeSessionLogSource } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

import { InteractiveSession } from '../../index.js';
import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const LARGE_RESPONSE = `ARCH_014_LARGE:${'x'.repeat(40 * 1024)}`;
const SENTINEL_RESPONSE = 'ARCH_014_SENTINEL';
const TEST_TIMEOUT_MS = 20_000;

let source: ScriptedSessionHarness | undefined;
let replaySession: InteractiveSession | undefined;
let replayWorkspace: string | undefined;

afterEach(async () => {
  await replaySession?.shutdown({ reason: 'other', message: 'functional test cleanup' });
  replaySession = undefined;
  if (replayWorkspace) rmSync(replayWorkspace, { recursive: true, force: true });
  replayWorkspace = undefined;
  await source?.dispose();
  source = undefined;
});

// ARCH-049: stable no-follow payload reads are Linux-only; the read refuses elsewhere.
describe.runIf(process.platform === 'linux')(
  'session-log external-payload replay (framework functional)',
  () => {
    it(
      'replays a large response byte-exactly without shifting the following response',
      async () => {
        source = scriptedSession({
          turns: [{ text: LARGE_RESPONSE }, { text: SENTINEL_RESPONSE }],
        });
        await source.submit('first recorded turn');
        await source.submit('second recorded turn');

        const reference = findExternalPayloadReference(source.logEntries());
        expect(reference).toBeDefined();
        expect(existsSync(join(source.logsDir(), reference!.relativePath))).toBe(true);

        const replayProvider = createReplayProviderFromSource(
          new NodeSessionLogSource(source.transcriptPath()),
        );
        replayWorkspace = mkdtempSync(join(tmpdir(), 'robota-replay-functional-'));
        replaySession = new InteractiveSession({
          cwd: replayWorkspace,
          provider: replayProvider,
          bare: true,
          permissionMode: 'bypassPermissions',
        });

        await submitAndWait(replaySession, 'first replay turn');
        await submitAndWait(replaySession, 'second replay turn');
        const replayed = replaySession
          .getMessages()
          .filter((message) => message.role === 'assistant')
          .map((message) => message.content);

        expect(replayed).toEqual([LARGE_RESPONSE, SENTINEL_RESPONSE]);
        expect(Buffer.byteLength(String(replayed[0]))).toBe(40_975);
        expect(createHash('sha256').update(String(replayed[0])).digest('hex')).toBe(
          '42bc9897b0c5ebe94994f5ef0b494461e1133116821ed9141c0d2043a0168193',
        );
      },
      TEST_TIMEOUT_MS,
    );
  },
);

async function submitAndWait(session: InteractiveSession, prompt: string): Promise<void> {
  const handle = await session.submit(prompt);
  await handle.completed;
}

interface IExternalReferenceView {
  readonly kind: 'external-payload';
  readonly relativePath: string;
}

function findExternalPayloadReference(value: unknown): IExternalReferenceView | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findExternalPayloadReference(item);
      if (match) return match;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === 'external-payload' && typeof record.relativePath === 'string') {
    return { kind: 'external-payload', relativePath: record.relativePath };
  }
  for (const child of Object.values(record)) {
    const match = findExternalPayloadReference(child);
    if (match) return match;
  }
  return undefined;
}
