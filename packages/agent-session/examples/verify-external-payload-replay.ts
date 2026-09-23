import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadSessionLogEntries,
  NodeSessionLogSource,
  replaySessionLogEntries,
  SessionLogPayloadResolutionError,
} from '@robota-sdk/agent-session';

const sessionId = 'stable-replay-example';
const fixtureRoot = mkdtempSync(join(tmpdir(), 'robota-stable-replay-'));
const logDirectory = join(fixtureRoot, 'logs');
const payloadDirectory = join(logDirectory, `${sessionId}.payloads`);
const outsideDirectory = join(fixtureRoot, 'outside');
const logFile = join(logDirectory, `${sessionId}.jsonl`);
const serializedPayload = JSON.stringify('replay-preserved');
const sha256 = createHash('sha256').update(serializedPayload).digest('hex');
const payloadName = `${sha256}.json`;
const relativePath = `${sessionId}.payloads/${payloadName}`;
let replayPreserved = false;
let replacementDenied = false;

try {
  mkdirSync(payloadDirectory, { recursive: true });
  writeFileSync(join(payloadDirectory, payloadName), serializedPayload);
  writeFileSync(
    logFile,
    `${JSON.stringify({
      timestamp: '2026-09-21T00:00:00.000Z',
      sessionId,
      event: 'history_mutation',
      mutation: 'append_message',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: {
          kind: 'external-payload',
          encoding: 'json',
          sha256,
          byteLength: Buffer.byteLength(serializedPayload),
          relativePath,
        },
        timestamp: '2026-09-21T00:00:00.000Z',
      },
    })}\n`,
  );

  const source = new NodeSessionLogSource(logFile);
  const replay = replaySessionLogEntries(loadSessionLogEntries(source));
  replayPreserved = replay.messages[0]?.content === 'replay-preserved';
  if (!replayPreserved) throw new Error('The external payload was not replayed byte-exactly.');

  rmSync(payloadDirectory, { recursive: true, force: true });
  mkdirSync(outsideDirectory);
  writeFileSync(join(outsideDirectory, payloadName), JSON.stringify('outside-marker'));
  symlinkSync(
    outsideDirectory,
    payloadDirectory,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  try {
    loadSessionLogEntries(source);
  } catch (error) {
    replacementDenied =
      error instanceof SessionLogPayloadResolutionError && error.code === 'OUTSIDE_ROOT';
  }
  if (!replacementDenied) {
    throw new Error(
      'Replacing the payload directory did not produce the stable containment refusal.',
    );
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const cleanupRemoved = !existsSync(fixtureRoot);
if (!cleanupRemoved) throw new Error('The isolated replay fixture was not removed.');

console.log(
  `result=${replayPreserved ? 'replay-preserved' : 'failed'}; replacementDenied=${replacementDenied}; cleanupRemoved=${cleanupRemoved}`,
);
