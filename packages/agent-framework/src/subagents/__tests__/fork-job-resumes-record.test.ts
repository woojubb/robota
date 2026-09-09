/**
 * CLI-1994 TC-03 — a fork job's conversation reaches the child through the SESSION STORE, never the
 * request.
 *
 * The runner receives `resumeSessionId` and nothing else about the conversation (ARCH-044). This
 * drives the real in-process runner over a real `NodeSessionStore` and a scripted provider and reads
 * what the provider was actually sent: with the id, the first request carries the copied
 * conversation under the parent's assembled system message; without it, only the job's own prompt
 * under the subagent prompt. RED with `resumeRequestedRecord` no longer called from `start()`.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInProcessSubagentRunner } from '../in-process-subagent-runner.js';

import type { IInProcessSubagentRunnerDeps } from '../in-process-subagent-runner.js';
import type { IResolvedConfig } from '../../config/config-types.js';
import type { ITerminalOutput, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';

const FORK_ID = 'session_cli-1994-fork';
const PARENT_PROMPT = 'PARENT ASSEMBLED PROMPT — CLI-1994 sentinel';
const COPIED_USER = 'Remember the number 42.';
const COPIED_ASSISTANT = 'Noted: 42.';
const JOB_PROMPT = 'Continue from where the parent left off.';

const NOOP_TERMINAL: ITerminalOutput = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: () => Promise.resolve(''),
  select: () => Promise.resolve(0),
  spinner: () => ({ stop: () => {}, update: () => {} }),
};

/** The config members `createSubagentSession` reads; the rest of `IResolvedConfig` is not consulted. */
const CONFIG = {
  provider: { name: 'scripted-test-provider', model: 'scripted-model' },
  permissions: { allow: [], deny: [] },
  defaultTrustLevel: 'moderate',
  currentProvider: 'scripted',
  env: {},
} as unknown as IResolvedConfig;

function copiedConversation(): TUniversalMessage[] {
  return [
    {
      id: 'm-1',
      role: 'user',
      content: COPIED_USER,
      timestamp: new Date('2026-08-01T00:00:00.000Z'),
      state: 'complete',
    },
    {
      id: 'm-2',
      role: 'assistant',
      content: COPIED_ASSISTANT,
      timestamp: new Date('2026-08-01T00:00:01.000Z'),
      state: 'complete',
    },
  ];
}

function job(cwd: string, resumeSessionId: string | undefined): ISubagentJobStart {
  return {
    taskId: 'agent_1',
    request: {
      agentType: 'general-purpose',
      label: 'fork',
      mode: 'background',
      parentSessionId: 'session_parent',
      depth: 1,
      cwd,
      prompt: JOB_PROMPT,
      permissionPolicy: 'inherit-allowlist',
      ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
    },
  };
}

function contentsOf(request: readonly TUniversalMessage[] | undefined): string[] {
  return (request ?? []).map((message) => String(message.content));
}

describe('a fork job resumes its record through the store (CLI-1994 TC-03)', () => {
  let cwd: string;
  let store: NodeSessionStore;
  let scripted: ReturnType<typeof createScriptedProvider>;
  let deps: IInProcessSubagentRunnerDeps;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-1994-job-')));
    store = new NodeSessionStore(join(cwd, 'sessions'));
    store.save({
      id: FORK_ID,
      name: 'parent (fork)',
      cwd,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      messages: copiedConversation(),
      systemPrompt: PARENT_PROMPT,
    });
    scripted = createScriptedProvider([{ text: 'the child answers' }]);
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

  it('with resumeSessionId, the first provider request carries the copied conversation under the parent prompt', async () => {
    const runner = createInProcessSubagentRunner(deps);

    const result = await runner.start(job(cwd, FORK_ID)).result;

    expect(result.output).toBe('the child answers');
    const first = scripted.requests[0];
    expect(first).toBeDefined();
    // The parent's ASSEMBLED prompt is the system head — not the subagent prompt the child was built with.
    expect(first?.[0]?.role).toBe('system');
    expect(first?.[0]?.content).toBe(PARENT_PROMPT);
    const contents = contentsOf(first);
    expect(contents).toContain(COPIED_USER);
    expect(contents).toContain(COPIED_ASSISTANT);
    // The job's own prompt follows the copy — the child continues the conversation, not a new one.
    expect(contents.indexOf(JOB_PROMPT)).toBeGreaterThan(contents.indexOf(COPIED_ASSISTANT));
  });

  it('persists the fork child turn back into the copied record', async () => {
    const runner = createInProcessSubagentRunner(deps);

    await runner.start(job(cwd, FORK_ID)).result;

    const loaded = store.load(FORK_ID);
    expect(loaded.status).toBe('valid');
    if (loaded.status !== 'valid') return;
    const messages = loaded.record.messages.map((message) => String(message.content));
    expect(messages).toContain(JOB_PROMPT);
    expect(messages).toContain('the child answers');
  });

  it('without resumeSessionId, the same job sends only its own prompt under the subagent prompt', async () => {
    const runner = createInProcessSubagentRunner(deps);

    await runner.start(job(cwd, undefined)).result;

    const contents = contentsOf(scripted.requests[0]);
    expect(contents).toContain(JOB_PROMPT);
    expect(contents).not.toContain(COPIED_USER);
    expect(contents).not.toContain(COPIED_ASSISTANT);
    expect(scripted.requests[0]?.[0]?.content).not.toBe(PARENT_PROMPT);
  });

  it('a runner composed without a record store refuses a fork job rather than starting it empty', () => {
    const { resumeSessionStore: _store, ...withoutStore } = deps;
    const runner = createInProcessSubagentRunner(withoutStore);

    expect(() => runner.start(job(cwd, FORK_ID))).toThrow(/resumeSessionStore/);
    expect(scripted.requests).toHaveLength(0);
  });

  it('a record the store cannot hand back fails the job, naming the outcome', () => {
    const runner = createInProcessSubagentRunner(deps);

    expect(() => runner.start(job(cwd, 'session_never-written'))).toThrow(
      /Cannot resume session session_never-written: .*"missing"/,
    );
    expect(scripted.requests).toHaveLength(0);
  });
});
