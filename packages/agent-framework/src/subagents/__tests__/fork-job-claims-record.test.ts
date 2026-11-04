/**
 * A fork job run in this process over a store that seals (#3679 step 3e).
 *
 * The job claims the record `/fork` left for it, for as long as it runs, the way every session this
 * process runs claims its own: the claim's read is what it restores from, it must be the owner's, and
 * every save the job makes carries the claim. A record something else put there — or swapped in
 * after the fork was written — is refused and never run.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider, createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore, isSessionClaimedError } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeForkedSessionRecord } from '../../interactive/interactive-session-fork-record.js';
import {
  claimable,
  forgeRecord,
  readFresh,
  record,
  authorshipOf,
  contentOf,
} from '../../interactive/__tests__/helpers/sealed-session-fixtures.js';
import { createInProcessSubagentRunner } from '../in-process-subagent-runner.js';

import type { IInProcessSubagentRunnerDeps } from '../in-process-subagent-runner.js';
import type { IResolvedConfig } from '../../config/config-types.js';
import type { IArtifactSealerDouble } from '@robota-sdk/agent-core/testing';
import type { ITerminalOutput, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';

const PARENT_TEXT = 'CANARY-3e2-parent-conversation-77b1';
const FORGED_TEXT = 'CANARY-3e2-swapped-fork-record-e4c0';

const NOOP_TERMINAL: ITerminalOutput = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: () => Promise.resolve(''),
  select: () => Promise.resolve(0),
  spinner: () => ({ stop: () => {}, update: () => {} }),
};

const CONFIG = {
  provider: { name: 'scripted-test-provider', model: 'scripted-model' },
  permissions: { allow: [], deny: [] },
  defaultTrustLevel: 'moderate',
  currentProvider: 'scripted',
  env: {},
} as unknown as IResolvedConfig;

function message(content: string): TUniversalMessage {
  return {
    id: `m-${content.length}`,
    role: 'user',
    content,
    timestamp: new Date('2026-11-01T00:00:00.000Z'),
    state: 'complete',
  } as TUniversalMessage;
}

function job(cwd: string, resumeSessionId: string): ISubagentJobStart {
  return {
    taskId: 'agent_fork',
    request: {
      agentType: 'general-purpose',
      label: 'fork',
      mode: 'background',
      parentSessionId: 'session_parent',
      depth: 1,
      cwd,
      prompt: 'carry on',
      permissionPolicy: 'inherit-allowlist',
      resumeSessionId,
    },
  };
}

describe('a fork job in this process over a store that seals', () => {
  let cwd: string;
  let dir: string;
  let sealer: IArtifactSealerDouble;
  let store: NodeSessionStore;
  let scripted: ReturnType<typeof createScriptedProvider>;
  let deps: IInProcessSubagentRunnerDeps;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'framework-fork-claim-')));
    dir = join(cwd, 'sessions');
    mkdirSync(dir, { mode: 0o700 });
    sealer = createTestArtifactSealer();
    store = new NodeSessionStore(dir, { sealing: { sealer } });
    scripted = createScriptedProvider([{ text: 'the fork answers' }]);
    deps = {
      config: CONFIG,
      context: { agentsMd: '', projectNotesMd: '' },
      tools: [],
      terminal: NOOP_TERMINAL,
      provider: scripted.provider,
      resumeSessionStore: store,
    };
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  /** `/fork` from a session whose content is the owner's. */
  function fork(): string {
    return writeForkedSessionRecord({
      source: {
        getHistory: () => [message(PARENT_TEXT)],
        getSystemMessage: () => 'the parent prompt',
        getToolSchemas: () => [],
      },
      fullHistory: () => [],
      sessionStore: store,
      requestedName: undefined,
      sourceName: 'parent',
      sourceId: 'session_parent',
      cwd,
    }).sessionId;
  }

  it('takes over the record /fork left, holds it while it runs, saves it as the owner’s and lets it go', async () => {
    const forkId = fork();
    const runner = createInProcessSubagentRunner(deps);

    const handle = runner.start(job(cwd, forkId));
    expect(claimable(store, forkId)).toBe(false);
    const result = await handle.result;

    expect(result.output).toBe('the fork answers');
    expect(JSON.stringify(scripted.requests[0])).toContain(PARENT_TEXT);
    expect(claimable(store, forkId)).toBe(true);
    const stored = readFresh(dir, sealer, forkId);
    expect(authorshipOf(stored)).toBe('verified');
    expect(contentOf(stored)).toContain('the fork answers');
  });

  it('runs the record /fork left even while the keys are locked', async () => {
    sealer.lock();
    const forkId = fork();
    const runner = createInProcessSubagentRunner(deps);

    const result = await runner.start(job(cwd, forkId)).result;

    expect(result.output).toBe('the fork answers');
    expect(JSON.stringify(scripted.requests[0])).toContain(PARENT_TEXT);
  });

  it('refuses a fork record swapped in after /fork wrote it, and runs nothing', () => {
    const forkId = fork();
    forgeRecord(dir, sealer, record(forkId, cwd, FORGED_TEXT));
    const runner = createInProcessSubagentRunner(deps);

    expect(() => runner.start(job(cwd, forkId))).toThrow(`Cannot resume session ${forkId}`);
    expect(scripted.requests).toHaveLength(0);
    expect(claimable(store, forkId)).toBe(true);
  });

  it('refuses a record nothing shows the owner wrote, which another store instance finds on disk', () => {
    forgeRecord(dir, sealer, record('session_planted_fork', cwd, FORGED_TEXT));
    const runner = createInProcessSubagentRunner(deps);

    let refusal: unknown;
    try {
      runner.start(job(cwd, 'session_planted_fork'));
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toMatchObject({ code: 'SESSION_AUTHORSHIP_REFUSED', reason: 'unverified' });
    expect((refusal as Error).message).not.toContain(FORGED_TEXT);
    expect(scripted.requests).toHaveLength(0);
    expect(claimable(store, 'session_planted_fork')).toBe(true);
  });

  it('refuses a record nobody vouched for even through a store view that forwards no claim', () => {
    forgeRecord(dir, sealer, record('session_planted_fork', cwd, FORGED_TEXT));
    const view = {
      save: (...args: Parameters<NodeSessionStore['save']>) => store.save(...args),
      load: (...args: Parameters<NodeSessionStore['load']>) => store.load(...args),
      list: () => store.list(),
      delete: (id: string) => store.delete(id),
    } as unknown as NodeSessionStore;
    const runner = createInProcessSubagentRunner({ ...deps, resumeSessionStore: view });

    expect(() => runner.start(job(cwd, 'session_planted_fork'))).toThrow();
    expect(scripted.requests).toHaveLength(0);
  });

  it('does not start a second job on a record a job is running', () => {
    const forkId = fork();
    const runner = createInProcessSubagentRunner({
      ...deps,
      provider: createScriptedProvider([{ text: 'one' }, { text: 'two' }]).provider,
    });

    const first = runner.start(job(cwd, forkId));
    let second: unknown;
    try {
      runner.start(job(cwd, forkId));
    } catch (error) {
      second = error;
    }

    expect(isSessionClaimedError(second)).toBe(true);
    return first.result;
  });
});
