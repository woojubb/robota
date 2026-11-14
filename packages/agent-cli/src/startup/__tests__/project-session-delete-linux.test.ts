/**
 * Deleting a project session through the store the CLI composition builds, over the real
 * workspace-root broker: everything the session left goes (log, payloads, checkpoints, subagent
 * logs, record) but the claims guard, a sibling session is untouched, and a checkpoint writer that
 * holds the session's lease stops the delete with its checkpoints and record in place.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { getWorkspaceProjectStateStorage } from '@robota-sdk/agent-framework';
import { WorkspaceSessionLogSink, resolveSubagentLogDir } from '@robota-sdk/agent-framework/node';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { startTestBroker } from '../../__tests__/helpers/test-workspace-root-broker.js';
import { BrokeredWorkspaceTrustService } from '../brokered-workspace-trust.js';
import { createCliWorkspaceComposition } from '../workspace-project-composition.js';
import { workspaceRootBrokerEndpoint } from '../workspace-root-broker-process.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

function record(id: string, cwd: string): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    messages: [],
  };
}

describe.skipIf(process.platform !== 'linux')('deleting a project session in the CLI', () => {
  it('removes everything the session left but its claims guard, and leaves a sibling as it was', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'cli-project-session-delete-'));
    const home = join(parent, 'home');
    const root = join(parent, 'root');
    mkdirSync(home);
    mkdirSync(root);
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'notes.txt'), 'before');
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const endpoint = workspaceRootBrokerEndpoint(runtime);
    mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
    const broker = await startTestBroker(
      endpoint,
      dirname(endpoint),
      runtime.layout.userPaths.workspaceTrust,
    );
    const service = await BrokeredWorkspaceTrustService.create(runtime);
    cleanups.push(async () => {
      service.close();
      await broker.close();
      rmSync(dirname(endpoint), { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    });
    const access = await service.grant(root, await service.prepare(root));
    if (access.status !== 'trusted') throw new Error('expected a trusted workspace');
    const composition = createCliWorkspaceComposition({
      cwd: root,
      productRuntime: runtime,
      projectAccess: access,
      platform: 'linux',
    });
    expect(composition.sessionStoreScope).toBe('project');
    const store = composition.sessionStore;
    const createCheckpoints = composition.createEditCheckpointStore;
    if (createCheckpoints === undefined) throw new Error('expected checkpoints on Linux');
    const sink = new WorkspaceSessionLogSink(
      getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
      { sealing: 'plain' },
    );
    const state = join(root, '.test-product');

    for (const id of ['session-a', 'session-b']) {
      store.save(record(id, root));
      sink.append(id, `{"type":"line","session":"${id}"}\n`);
      const payload = JSON.stringify({ large: id });
      sink.writeJson(id, createHash('sha256').update(payload).digest('hex'), payload);
      const checkpoints = createCheckpoints();
      await checkpoints.beginTurn({ sessionId: id, prompt: `edit for ${id}` });
      await checkpoints.captureFile(join(root, 'notes.txt'));
      await checkpoints.finalizeTurn();
      const subagents = resolveSubagentLogDir(id, runtime.layout.subagentLogsRoot);
      mkdirSync(subagents, { recursive: true });
      writeFileSync(join(subagents, 'agent-1.jsonl'), '{"line":1}\n');
    }
    const before = files(state);
    const ofA = (paths: string[]) => paths.filter((path) => path.includes('session-a'));
    expect(ofA(before)).toEqual(
      expect.arrayContaining([
        'logs/session-a.jsonl',
        expect.stringMatching(/^logs\/session-a\.payloads\//u),
        expect.stringMatching(/^checkpoints\/session-a\/turn-\d+\/manifest\.json$/u),
        'sessions/session-a.json',
      ]),
    );
    const ofB = before.filter((path) => path.includes('session-b'));

    // A checkpoint writer in the middle of a turn holds session-a's lease: the delete stops with
    // nothing of its checkpoints touched and its subagent logs and record in place, so the session
    // is still listed and loads; its log and payloads, removed first by design, are gone.
    const writer = createCheckpoints();
    await writer.beginTurn({ sessionId: 'session-a', prompt: 'still writing' });
    expect(() => store.delete('session-a')).toThrow(
      'Session session-a was not deleted: a checkpoint writer is using it. Try again once it has finished.',
    );
    const stopped = ofA(files(state));
    expect(stopped).toEqual(
      expect.arrayContaining(ofA(before).filter((path) => !path.startsWith('logs/'))),
    );
    expect(stopped.filter((path) => path.startsWith('logs/'))).toEqual([]);
    expect(files(join(runtime.layout.subagentLogsRoot, 'session-a'))).toEqual([
      'subagents/agent-1.jsonl',
    ]);
    expect(store.load('session-a').status).toBe('valid');
    expect(
      store
        .list()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(['session-a', 'session-b']);
    await writer.finalizeTurn();

    store.delete('session-a');
    const after = files(state);
    expect(ofA(after)).toEqual(['sessions/claims/session-a.guard']);
    expect(after.filter((path) => path.includes('session-b'))).toEqual(ofB);
    expect(store.load('session-a').status).toBe('missing');
    expect(store.list().map((entry) => entry.id)).toEqual(['session-b']);
    expect(existsSync(join(runtime.layout.subagentLogsRoot, 'session-a'))).toBe(false);
    expect(files(join(runtime.layout.subagentLogsRoot, 'session-b'))).toEqual([
      'subagents/agent-1.jsonl',
    ]);

    // A line or payload the sink still flushes for the deleted session creates nothing: its later
    // appends do not create the log through the broker.
    sink.append('session-a', '{"type":"late"}\n');
    const late = JSON.stringify({ late: true });
    sink.writeJson('session-a', createHash('sha256').update(late).digest('hex'), late);
    expect(ofA(files(state))).toEqual(['sessions/claims/session-a.guard']);
  }, 60_000);
});
