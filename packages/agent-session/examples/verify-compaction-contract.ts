import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AbstractAIProvider } from '@robota-sdk/agent-core';

import {
  SESSION_LOG_EVENT,
  Session,
  isSessionLogEvent,
  type ISpinner,
  type ITerminalOutput,
} from '../src/index.js';

import type {
  IChatOptions,
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
  THooksConfig,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

const PREVIOUSLY_UNDECLARED_EVENTS = [
  'provider_stream_raw_delta',
  'assistant_message_committed',
  'tool_batch_started',
  'tool_message_committed',
  'session_shutdown_step_error',
  'background_task_event',
  'background_job_group_event',
  'memory_event',
] as const;

class OfflineCompactionProvider extends AbstractAIProvider {
  override readonly name = 'arch-016-offline';
  override readonly version = '1.0.0';

  override async chat(
    _messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    return {
      id: `example-${Date.now()}-1`,
      role: 'assistant',
      content: 'deterministic compact summary',
      timestamp: new Date('2026-08-15T00:00:00.000Z'),
      state: 'complete',
    };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    yield await this.chat(messages, options);
  }
}

const silentTerminal: ITerminalOutput = {
  writeError(_text: string): void {},
  async prompt(): Promise<string> {
    // A silent example terminal answers nothing rather than blocking; `ITerminalOutput` requires the
    // member, and a stub that omitted it only compiled because nothing typechecked this directory.
    return '';
  },
  async select(_options: string[], initialIndex = 0): Promise<number> {
    return initialIndex;
  },
  write(): void {},
  writeLine(): void {},
  writeMarkdown(): void {},
  spinner(): ISpinner {
    return { stop(): void {}, update(): void {} };
  },
};

const compactHooks: THooksConfig = {
  PreCompact: [{ matcher: '', hooks: [{ type: 'command', command: 'record' }] }],
  PostCompact: [{ matcher: '', hooks: [{ type: 'command', command: 'record' }] }],
};

function createSession(cwd: string, hookInputs: IHookInput[]): Session {
  const executor: IHookTypeExecutor = {
    type: 'command',
    execute: async (_definition, input): Promise<IHookResult> => {
      hookInputs.push(input);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
  const session = new Session({
    cwd,
    tools: [],
    provider: new OfflineCompactionProvider(),
    systemMessage: 'ARCH-016 deterministic compaction contract',
    terminal: silentTerminal,
    defaultTrustLevel: 'full',
    hooks: compactHooks,
    hookTypeExecutors: [executor],
  });
  session.injectMessage('user', 'content to compact');
  session.injectMessage('assistant', 'response to compact');
  return session;
}

function triggers(inputs: IHookInput[]): Array<IHookInput['trigger']> {
  return inputs
    .filter(
      (input) => input.hook_event_name === 'PreCompact' || input.hook_event_name === 'PostCompact',
    )
    .map((input) => input.trigger);
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-016-example-'));
  const manualInputs: IHookInput[] = [];
  const autoInputs: IHookInput[] = [];
  let manualSession: Session | undefined;
  let autoSession: Session | undefined;
  let result:
    | {
        manualCompaction: { hookTriggers: Array<IHookInput['trigger']> };
        autoCompaction: { hookTriggers: Array<IHookInput['trigger']> };
        vocabulary: { unrecognizedEvents: string[] };
      }
    | undefined;

  try {
    manualSession = createSession(cwd, manualInputs);
    await manualSession.compact();
    autoSession = createSession(cwd, autoInputs);
    await autoSession.compact(undefined, 'auto');

    const declared = new Set(Object.values(SESSION_LOG_EVENT));
    const unrecognizedEvents = PREVIOUSLY_UNDECLARED_EVENTS.filter((event) => {
      const line = { timestamp: '', sessionId: '', event };
      return !declared.has(event) || !isSessionLogEvent(line, event);
    });
    result = {
      manualCompaction: { hookTriggers: triggers(manualInputs) },
      autoCompaction: { hookTriggers: triggers(autoInputs) },
      vocabulary: { unrecognizedEvents },
    };

    if (JSON.stringify(result.manualCompaction.hookTriggers) !== '["manual","manual"]') {
      throw new Error('manual compaction hooks did not receive one manual trigger');
    }
    if (JSON.stringify(result.autoCompaction.hookTriggers) !== '["auto","auto"]') {
      throw new Error('auto compaction hooks did not receive one auto trigger');
    }
    if (unrecognizedEvents.length !== 0) {
      throw new Error(`unrecognized production events: ${unrecognizedEvents.join(', ')}`);
    }
  } finally {
    await manualSession?.shutdown();
    await autoSession?.shutdown();
    rmSync(cwd, { recursive: true, force: true });
  }

  if (!result) throw new Error('scenario did not produce a result');
  process.stdout.write(`${JSON.stringify({ ...result, cleanupRemoved: !existsSync(cwd) })}\n`);
}

void main();
