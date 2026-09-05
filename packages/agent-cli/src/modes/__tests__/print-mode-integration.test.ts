/**
 * Print mode integration tests (CLI-063).
 *
 * Drives runPrintMode with a real file-backed session store and a stub provider
 * to verify session resume/fork semantics that the TUI already has.
 */

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPrintMode } from '../print-mode.js';
import { buildServeSessionOptions } from '../serve-mode.js';
import { presetSessionFields } from '../../startup/preset-session-fields.js';
import {
  buildPresetSurfaceOptions,
  toSessionOptions,
} from '../../startup/preset-surface-options.js';

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
    open: false,
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
    memory: undefined,
    memoryAutoSave: false,
    ...overrides,
  };
}

async function runPrint(
  cwd: string,
  prompt: string,
  provider: IAIProvider,
  sessionResolution: IPrintModeSessionResolution = {},
): Promise<number> {
  const sessionStore = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'));
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
      {},
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
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-print-resume-')));
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
    const store = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'));
    expect(store.list()).toHaveLength(1);
  });

  it('TC-02: resume loads prior messages into the provider request and creates no extra session', async () => {
    const first = createRecordingProvider('first answer');
    await runPrint(cwd, 'Remember this number: 42', first.provider);

    const store = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'));
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

    const ids = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'))
      .list()
      .map((record) => record.id);
    expect(ids).toEqual([priorId]);
  });

  it('TC-03: fork creates a new independent session with restored context, original untouched (CLI-073 semantics)', async () => {
    const first = createRecordingProvider('first answer');
    await runPrint(cwd, 'Remember this number: 42', first.provider);

    const store = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'));
    const priorEntry = store.list()[0];
    if (priorEntry?.outcome.status !== 'valid') {
      throw new Error(
        `expected a readable prior session, store reported ${priorEntry?.outcome.status}`,
      );
    }
    const priorRecord = priorEntry.outcome.record;
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

    const afterEntries = createNodeHostSessionStore(join(cwd, '.robota', 'sessions')).list();
    const after = afterEntries.flatMap((e) =>
      e.outcome.status === 'valid' ? [e.outcome.record] : [],
    );
    expect(after).toHaveLength(2);
    const original = after.find((record) => record.id === priorRecord.id);
    expect(original).toBeDefined();
    expect(original?.messages).toHaveLength(priorMessageCount);
    expect(stdoutWriteCount).toBeGreaterThan(0);
  });
});

/**
 * Issue #1937 — the CLI-sourced prompt flags must reach the surface, not just the helper.
 *
 * `buildAppendSystemPrompt` had exactly one caller, so `--append-system-prompt`, `--task-file` and
 * `--json-schema` were parsed, validated and then dropped in interactive and serve mode. A test of
 * the helper passes in that state, which is why these assert what the PROVIDER received: the system
 * message is the only place the flags' effect is observable, and it is where the defect showed.
 */
describe('CLI-sourced prompt flags reach the session (issue #1937)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-append-prompt-')));
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  function systemTextOf(messages: TUniversalMessage[]): string {
    return messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content ?? '')
      .join('\n');
  }

  it('print mode: the composed addition arrives on the projection, not from a second helper call', async () => {
    const { provider, lastMessages } = createRecordingProvider('ok');
    const sessionStore = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'));
    try {
      await runPrintMode(
        cwd,
        makeArgs({ positional: ['hello'] }),
        provider,
        sessionStore,
        [],
        (() => {
          throw new Error('subagent runner not used here');
        }) as never,
        [],
        {},
        [],
        {} as never,
        {},
        { cliAppendSystemPrompt: 'REMEMBER-THE-PASSPHRASE' },
      );
    } catch (error) {
      if (!(error instanceof ExitSentinel)) throw error;
    }
    expect(systemTextOf(lastMessages())).toContain('REMEMBER-THE-PASSPHRASE');
  });

  it('serve mode: the served session receives the same addition', () => {
    // Asserted on the OPTIONS the served runtime starts with, not on the helper — serve is the
    // surface where a missing forward is least visible, because nothing there prints the prompt.
    // `TInteractiveSessionOptions` is a union, and the injected member has no `appendSystemPrompt`
    // because it takes an already-built session. Serve always builds the standard member, so the
    // read is narrowed here rather than by widening the framework's public surface for a test.
    const options = buildServeSessionOptions({
      cwd,
      args: makeArgs({}),
      preset: { cliAppendSystemPrompt: 'SERVED-ADDITION' },
    } as never) as { appendSystemPrompt?: string };
    expect(options.appendSystemPrompt).toBe('SERVED-ADDITION');
  });

  it('the shared mapper takes the tool lists from the PRESET SURFACE (issue #1934)', () => {
    // The claim the projection test could not make. It asserts the mode surfaces ACCEPT every field
    // — a compile-time property — and both modes accepted `allowedTools` while reading
    // `parseToolList(args.…)` instead. Accepting a field and reading it are different claims.
    expect(
      presetSessionFields({
        allowedTools: ['FromPreset'],
        deniedTools: ['DeniedByPreset'],
        cliAppendSystemPrompt: 'CLI-TEXT',
      }),
    ).toEqual({
      allowedTools: ['FromPreset'],
      deniedTools: ['DeniedByPreset'],
      appendSystemPrompt: 'CLI-TEXT',
    });
  });

  it('the mapper omits what the surface did not state, rather than emptying it', () => {
    // The guard: returning `allowedTools: []` for a surface that named none would read as "nothing is
    // permitted" at the session, which is the opposite of absent.
    expect(presetSessionFields({})).toEqual({});
  });

  it('serve mode reads the RESOLVED tool lists, not the raw flags (issue #1934)', () => {
    // The review finding this pins: both modes took `IPresetSurfaceOptions` and read
    // `parseToolList(args.…)` anyway, so a preset's lists were applied in the TUI and silently
    // ignored under `-p` and `--serve` — the half-applied divergence the item exists to close,
    // reintroduced at two of three shells. The projection test above cannot catch it: it asserts the
    // surfaces ACCEPT the field, which is a compile-time property, not that they READ it.
    const options = buildServeSessionOptions({
      cwd,
      args: makeArgs({ allowedTools: 'FromFlag', deniedTools: 'FromFlag' }),
      preset: { allowedTools: ['FromPreset'], deniedTools: ['DeniedByPreset'] },
    } as never) as { allowedTools?: readonly string[]; deniedTools?: readonly string[] };

    expect(options.allowedTools).toEqual(['FromPreset']);
    expect(options.deniedTools).toEqual(['DeniedByPreset']);
  });

  it('the projection carries what the three flags compose, so every surface reads one value', () => {
    // Composed BY the projection, from the raw flags — not handed in already composed. That is the
    // hop the defect was at: the helper worked, and one shell of three called it.
    const surface = buildPresetSurfaceOptions({} as never, 'acme', 'default', {
      cwd,
      args: makeArgs({ appendSystemPrompt: 'FROM-FLAG' }),
    });
    expect(surface.cliAppendSystemPrompt).toBe('FROM-FLAG');
    // interactive receives it through this hop and no other, renamed onto the session's own key —
    // and kept off the preset's `appendSystemPrompt` until here, so the merge order stays open.
    expect(toSessionOptions(surface).appendSystemPrompt).toBe('FROM-FLAG');
  });
});
