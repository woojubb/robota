import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { createReplayProviderFromSource } from '@robota-sdk/agent-provider-replay';
import { NodeSessionLogSink, NodeSessionLogSource } from '@robota-sdk/agent-session';

import { InteractiveSession } from '../src/index.js';

const LARGE_RESPONSE = `ARCH_014_LARGE:${'x'.repeat(40 * 1024)}`;
const SENTINEL_RESPONSE = 'ARCH_014_SENTINEL';
const EXPECTED_SHA256 = '42bc9897b0c5ebe94994f5ef0b494461e1133116821ed9141c0d2043a0168193';

interface IExternalReferenceView {
  readonly relativePath: string;
}

// Contained — ARCH-049. Stable no-follow external-payload reads exist only on Linux
// (session-log-sources.ts refuses other hosts by design), so this scenario cannot run here.
// It says so explicitly instead of failing on a refusal it cannot influence.
if (process.platform !== 'linux') {
  console.log(
    JSON.stringify({
      notApplicable: true,
      reason:
        'ARCH-049: stable external-payload reads are Linux-only; scenario skipped on this host',
      platform: process.platform,
    }),
  );
  process.exit(0);
}

let sourceSession: InteractiveSession | undefined;
let sourceWorkspace: string | undefined;
let replaySession: InteractiveSession | undefined;
let replayWorkspace: string | undefined;

try {
  sourceWorkspace = mkdtempSync(join(tmpdir(), 'robota-arch-014-source-'));
  const sourceWorkspacePath = sourceWorkspace;
  const sourceProvider = createScriptedProvider([
    { text: LARGE_RESPONSE },
    { text: SENTINEL_RESPONSE },
  ]).provider;
  sourceSession = new InteractiveSession({
    cwd: sourceWorkspacePath,
    provider: sourceProvider,
    resumeSessionId: 'arch-014-source',
    sessionLogSink: new NodeSessionLogSink(join(sourceWorkspacePath, '.robota', 'logs')),
    bare: true,
    permissionMode: 'bypassPermissions',
  });
  await submitAndWait(sourceSession, 'first recorded turn');
  await submitAndWait(sourceSession, 'second recorded turn');

  const transcriptPath = join(sourceWorkspacePath, '.robota', 'logs', 'arch-014-source.jsonl');
  const entries = readFileSync(transcriptPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
  const reference = findExternalPayloadReference(entries);
  if (!reference) throw new Error('No external payload reference was written to the source JSONL.');
  const logDirectory = join(sourceWorkspacePath, '.robota', 'logs');
  const sidecarExists = existsSync(join(logDirectory, reference.relativePath));
  if (!sidecarExists)
    throw new Error(`External payload sidecar is missing: ${reference.relativePath}`);

  const replayProvider = createReplayProviderFromSource(new NodeSessionLogSource(transcriptPath));
  replayWorkspace = mkdtempSync(join(tmpdir(), 'robota-arch-014-replay-'));
  const replayWorkspacePath = replayWorkspace;
  replaySession = new InteractiveSession({
    cwd: replayWorkspacePath,
    provider: replayProvider,
    bare: true,
    permissionMode: 'bypassPermissions',
  });
  await submitAndWait(replaySession, 'first replay turn');
  await submitAndWait(replaySession, 'second replay turn');

  const replayed = replaySession
    .getMessages()
    .filter((message) => message.role === 'assistant')
    .map((message) => String(message.content));
  const largeResponse = replayed[0];
  const sentinel = replayed[1];
  if (largeResponse !== LARGE_RESPONSE)
    throw new Error('Large response was not replayed byte-exactly.');
  if (sentinel !== SENTINEL_RESPONSE) throw new Error('Sentinel response was not replay call 2.');
  const byteLength = Buffer.byteLength(largeResponse);
  const sha256 = createHash('sha256').update(largeResponse).digest('hex');
  if (byteLength !== 40_975 || sha256 !== EXPECTED_SHA256) {
    throw new Error(`Large response integrity mismatch: ${byteLength} bytes, ${sha256}.`);
  }

  await replaySession.shutdown({ reason: 'other', message: 'ARCH-014 scenario complete' });
  replaySession = undefined;
  rmSync(replayWorkspacePath, { recursive: true, force: true });
  replayWorkspace = undefined;
  await sourceSession.shutdown({ reason: 'other', message: 'ARCH-014 scenario complete' });
  sourceSession = undefined;
  rmSync(sourceWorkspacePath, { recursive: true, force: true });
  sourceWorkspace = undefined;

  const sourceWorkspaceRemoved = !existsSync(sourceWorkspacePath);
  const replayWorkspaceRemoved = !existsSync(replayWorkspacePath);
  if (!sourceWorkspaceRemoved || !replayWorkspaceRemoved) {
    throw new Error('Scenario cleanup did not remove both temporary workspaces.');
  }

  console.log(
    JSON.stringify(
      {
        externalPayload: {
          present: true,
          relativePath: reference.relativePath.split('\\').join('/'),
          sidecarExists,
        },
        largeResponse: {
          byteLength,
          sha256,
          matchesOriginal: true,
        },
        sentinel: {
          callIndex: 2,
          value: sentinel,
          aligned: true,
        },
        cleanup: { sourceWorkspaceRemoved, replayWorkspaceRemoved },
      },
      null,
      2,
    ),
  );
} finally {
  await replaySession?.shutdown({ reason: 'other', message: 'ARCH-014 scenario cleanup' });
  if (replayWorkspace) rmSync(replayWorkspace, { recursive: true, force: true });
  await sourceSession?.shutdown({ reason: 'other', message: 'ARCH-014 scenario cleanup' });
  if (sourceWorkspace) rmSync(sourceWorkspace, { recursive: true, force: true });
}

async function submitAndWait(session: InteractiveSession, prompt: string): Promise<void> {
  const handle = await session.submit(prompt);
  await handle.completed;
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
    return { relativePath: record.relativePath };
  }
  for (const child of Object.values(record)) {
    const match = findExternalPayloadReference(child);
    if (match) return match;
  }
  return undefined;
}
