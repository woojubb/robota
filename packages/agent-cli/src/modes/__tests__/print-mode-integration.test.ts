/**
 * Print mode integration tests (CLI-063).
 *
 * Drives runPrintMode with a real file-backed session store and a stub provider
 * to verify session resume/fork semantics that the TUI already has.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPrintMode } from '../print-mode.js';

import type { IPrintModeSessionResolution } from '../print-mode.js';
import type { IParsedCliArgs } from '../../utils/cli-args.js';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface IRecordingProvider {
  provider: IAIProvider;
  /** Messages of the most recent chat() call. */
  lastMessages(): TUniversalMessage[];
}

function createRecordingProvider(response: string): IRecordingProvider {
  let last: TUniversalMessage[] = [];
  const provider: IAIProvider = {
    name: 'print-test-provider',
    version: '1.0.0',
    async chat(messages) {
      last = messages;
      return {
        id: `assistant-${last.length}`,
        role: 'assistant',
        content: response,
        state: 'complete',
        timestamp: new Date(),
      };
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools() {
      return true;
    },
    validateConfig() {
      return true;
    },
  };
  return { provider, lastMessages: () => last };
}

function makeArgs(overrides: Partial<IParsedCliArgs> = {}): IParsedCliArgs {
  return {
    positional: [],
    help: false,
    printMode: true,
    serve: false,
    continueMode: false,
    resumeId: undefined,
    language: undefined,
    permissionMode: undefined,
    maxTurns: 1,
    goal: undefined,
    goalMaxIterations: undefined,
    forkSession: false,
    sessionName: undefined,
    outputFormat: 'text',
    format: undefined,
    summary: undefined,
    source: undefined,
    systemPrompt: undefined,
    appendSystemPrompt: undefined,
    taskFile: undefined,
    version: false,
    reset: false,
    bare: false,
    allowedTools: undefined,
    deniedTools: undefined,
    model: undefined,
    preset: undefined,
    noSessionPersistence: false,
    jsonSchema: undefined,
    configure: false,
    configureProvider: undefined,
    provider: undefined,
    sessionLog: undefined,
    providerType: undefined,
    baseURL: undefined,
    apiKey: undefined,
    apiKeyEnv: undefined,
    setCurrent: false,
    settingsScope: undefined,
    checkUpdate: false,
    disableUpdateCheck: false,
    dryRun: false,
    yes: false,
    ...overrides,
  };
}

async function runPrint(
  cwd: string,
  prompt: string,
  provider: IAIProvider,
  sessionResolution: IPrintModeSessionResolution = {},
): Promise<number> {
  const sessionStore = createProjectSessionStore(cwd);
  try {
    await runPrintMode(
      cwd,
      makeArgs({ positional: [prompt] }),
      provider,
      sessionStore,
      [],
      (() => {
        throw new Error('subagent runner not used in print-mode resume tests');
      }) as never,
      [],
      {} as never,
      sessionResolution,
    );
  } catch (error) {
    if (error instanceof ExitSentinel) {
      return error.code;
    }
    throw error;
  }
  throw new Error('runPrintMode returned without calling process.exit');
}

describe('print mode session resume integration (CLI-063)', () => {
  let cwd: string;
  let stdoutWriteCount = 0;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-print-resume-'));
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    stdoutWriteCount = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((() => {
      stdoutWriteCount += 1;
      return true;
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('TC-06: starts exactly one new session when no resume id is given (continue-or-start)', async () => {
    const { provider } = createRecordingProvider('first answer');
    const exitCode = await runPrint(cwd, 'Remember this number: 42', provider);

    expect(exitCode).toBe(0);
    const store = createProjectSessionStore(cwd);
    expect(store.list()).toHaveLength(1);
  });

  it('TC-02: resume loads prior messages into the provider request and creates no extra session', async () => {
    const first = createRecordingProvider('first answer');
    await runPrint(cwd, 'Remember this number: 42', first.provider);

    const store = createProjectSessionStore(cwd);
    const priorId = store.list()[0]?.id;
    expect(priorId).toBeDefined();

    const second = createRecordingProvider('it was 42');
    const exitCode = await runPrint(
      cwd,
      'What number did I ask you to remember?',
      second.provider,
      {
        resumeSessionId: priorId,
      },
    );

    expect(exitCode).toBe(0);
    const contents = second
      .lastMessages()
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');
    expect(contents).toContain('Remember this number: 42');
    expect(contents).toContain('first answer');
    expect(contents).toContain('What number did I ask you to remember?');

    const ids = createProjectSessionStore(cwd)
      .list()
      .map((record) => record.id);
    expect(ids).toEqual([priorId]);
  });

  it('TC-03: fork creates a new independent session with restored context, original untouched (CLI-073 semantics)', async () => {
    const first = createRecordingProvider('first answer');
    await runPrint(cwd, 'Remember this number: 42', first.provider);

    const store = createProjectSessionStore(cwd);
    const priorRecord = store.list()[0];
    expect(priorRecord).toBeDefined();
    const priorMessageCount = priorRecord.messages.length;

    const forked = createRecordingProvider('forked answer');
    const exitCode = await runPrint(cwd, 'And in the fork?', forked.provider, {
      resumeSessionId: priorRecord.id,
      forkSession: true,
    });

    expect(exitCode).toBe(0);
    // Framework fork semantics (CLI-073, SPEC-conform): a fork is a fresh UUID WITH
    // the source conversation restored — prior messages ARE injected, same as resume.
    const contents = forked
      .lastMessages()
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');
    expect(contents).toContain('And in the fork?');
    expect(contents).toContain('Remember this number: 42');

    const after = createProjectSessionStore(cwd).list();
    expect(after).toHaveLength(2);
    const original = after.find((record) => record.id === priorRecord.id);
    expect(original).toBeDefined();
    expect(original?.messages).toHaveLength(priorMessageCount);
    expect(stdoutWriteCount).toBeGreaterThan(0);
  });
});
