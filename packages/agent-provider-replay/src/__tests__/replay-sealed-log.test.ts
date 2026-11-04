/**
 * `--session-log` replays plain logs only (#3679, secure conversation): a sealed log is refused with
 * fixed text that says so, instead of an `ArtifactLockedError` escaping from the startup path. The
 * dev harness holds no keys, and a replay that opened sealed logs would need them.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionLogSink } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it } from 'vitest';

import { createReplayProviderFromNodeLogFile } from '../index.js';

const CANARY = 'CANARY-7a2e-recorded-provider-response';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('replaying a sealed session log', () => {
  it('is refused with fixed text that says only plain logs replay', () => {
    const logs = realpathSync(mkdtempSync(join(tmpdir(), 'replay-sealed-')));
    roots.push(logs);
    new NodeSessionLogSink(logs, { sealing: { sealer: createTestArtifactSealer() } }).append(
      's1',
      `${JSON.stringify({ schemaVersion: 1, timestamp: '2026-11-01T00:00:00.000Z', sessionId: 's1', event: 'user', content: CANARY })}\n`,
    );

    let failure: unknown;
    try {
      createReplayProviderFromNodeLogFile(join(logs, 's1.jsonl'));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'The session log is sealed, and the replay provider replays plain logs only.',
    );
    expect((failure as { code?: unknown }).code).toBeUndefined();
    expect((failure as Error).message).not.toContain(CANARY);
  });
});
