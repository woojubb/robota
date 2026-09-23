/**
 * createBinaryAgentDriver — the built-binary implementation of the client-side agent contract
 * (`IAgentDriver`, INFRA-020). agent-cli owns this because it drives **its own** artifact (the robota
 * CLI binary); per the no-shared-CLI-factory rule the CLI tests itself, it is not driven by a shared
 * factory.
 *
 * Each `send` runs the binary once in print mode with `--output-format stream-json` and parses the
 * emitted events into the shared `InteractionEvent` stream — so the SAME scenario written against
 * `IAgentDriver` can run in-process (the programmatic driver) and against the real binary, proving the
 * contract holds across fidelities. Determinism comes from `--session-log` (the replay provider): no
 * model key, no network. (Print mode is one-shot and non-interactive, so this uses a piped child
 * process, not the PTY runner — the PTY runner is for interactive TUI rendering.)
 *
 * **Tool events come from the persisted session record, not from stdout (SEC-022, issue #2225).**
 * `--output-format stream-json` has no tool event in its vocabulary — measured on a run whose tool
 * demonstrably executed, stdout carried zero lines mentioning `tool`. Deriving `toolCalls()` from
 * stdout therefore returned `[]` for a run whose tool ran, so the binary fidelity disagreed with the
 * in-process one SILENTLY, by returning an empty array rather than failing. The record the run writes
 * carries the calls and their results, so that is what this reads. `appendStreamJsonLine` is
 * unchanged: stdout keeps meaning exactly what it means today.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readAssistantReplies,
  readErrors,
  readLastAssistantText,
  readToolCalls,
} from '@robota-sdk/agent-interface-session';

import type {
  IAgentDriver,
  IToolCallObservation,
  InteractionEvent,
} from '@robota-sdk/agent-interface-session';

const DEFAULT_BIN = fileURLToPath(new URL('../../bin/robota.cjs', import.meta.url));

export interface ICreateBinaryAgentDriverOptions {
  /** Working directory the binary runs in (a provider profile + cwd-scoped sessions live here). */
  cwd: string;
  /** Path to the built robota CLI (defaults to this package's `bin/robota.cjs`). */
  binPath?: string;
  /** Recorded session log for deterministic replay (`--session-log`); no model key is used. */
  sessionLog?: string;
  /**
   * Extra environment for the child (PATH/HOME are supplied by default). **Pass a throwaway `HOME`:**
   * since SEC-022 the run persists its session record under `<HOME>/.robota/sessions`, which is where
   * this driver reads the tool calls back from — the process `HOME` default would write into the
   * developer's real one.
   */
  env?: NodeJS.ProcessEnv;
  /** Extra CLI args appended to every `send` invocation. */
  extraArgs?: readonly string[];
}

/** Parse one stream-json line into a plain object, or `null` if it is not a JSON object. */
function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // allow-fallback: stream-json emits one JSON object per line; non-JSON noise is ignored, not fatal
    return null;
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

/** Map one parsed stream-json line onto zero or more InteractionEvents. */
function appendStreamJsonLine(line: string, events: InteractionEvent[]): void {
  const obj = parseJsonLine(line);
  if (!obj) return;

  if (obj['type'] === 'stream_event') {
    const event = obj['event'] as { type?: string; delta?: { type?: string; text?: string } };
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      events.push({ type: 'assistant-chunk', chunk: event.delta.text ?? '' });
    }
    return;
  }

  if (obj['type'] === 'result') {
    if (obj['subtype'] === 'error') {
      events.push({
        type: 'error',
        error: new Error(typeof obj['error'] === 'string' ? obj['error'] : 'binary run failed'),
      });
    } else {
      events.push({
        type: 'assistant-done',
        fullText: typeof obj['result'] === 'string' ? obj['result'] : '',
      });
    }
  }
}

/** One tool call as the persisted record carries it (the provider-normalized function shape). */
interface IRecordedToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** One message as the persisted record carries it — only the fields this reader needs. */
interface IRecordedMessage {
  role?: string;
  name?: string;
  content?: string;
  toolCallId?: string;
  toolCalls?: readonly IRecordedToolCall[];
}

/** The session id a run reports on its own stream — not a newest-file guess. */
function readSessionId(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const obj = parseJsonLine(line);
    const id = obj?.['session_id'];
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return undefined;
}

/** A recorded `arguments` blob is a JSON string by convention; the raw text is kept when it is not. */
function parseToolArguments(raw: string | undefined): IToolCallObservation['args'] {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // allow-fallback: `args` is typed `unknown` on the contract, and a non-JSON argument blob IS the
    // observation — the raw text is reported rather than substituted for or swallowed
    return raw;
  }
}

/**
 * Append the `tool-call` / `tool-result` events the run persisted, in recorded order.
 *
 * If the record is absent — session persistence off, or a trusted project that stores elsewhere —
 * no tool event is appended. That is the accurate answer and NOT a fallback: the record is the
 * source, and stdout is not a substitute for it (SEC-022 `## Fallback & Degradation Declaration`).
 */
function appendRecordedToolEvents(
  homeDir: string,
  sessionId: string | undefined,
  events: InteractionEvent[],
): void {
  if (sessionId === undefined || homeDir.length === 0) return;
  const file = join(homeDir, '.robota', 'sessions', `${sessionId}.json`);
  if (!existsSync(file)) return;
  const envelope = JSON.parse(readFileSync(file, 'utf8')) as {
    record?: { messages?: readonly IRecordedMessage[] };
  };
  for (const message of envelope.record?.messages ?? []) {
    if (message.role === 'assistant' && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) {
        events.push({
          type: 'tool-call',
          id: call.id ?? '',
          name: call.function?.name ?? '',
          args: parseToolArguments(call.function?.arguments),
        });
      }
    }
    if (message.role === 'tool') {
      events.push({
        type: 'tool-result',
        id: message.toolCallId ?? '',
        name: message.name ?? '',
        result: message.content,
      });
    }
  }
}

export function createBinaryAgentDriver(options: ICreateBinaryAgentDriverOptions): IAgentDriver {
  const events: InteractionEvent[] = [];
  const binPath = options.binPath ?? DEFAULT_BIN;
  const childEnv = options.env ?? {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
  };
  // Where the run's own record lands: `~/.robota/sessions` is resolved from the CHILD's HOME.
  const homeDir = childEnv['HOME'] ?? '';

  const runPrint = (text: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      events.push({ type: 'user-message', text });
      const args = [
        binPath,
        '-p',
        text,
        '--output-format',
        'stream-json',
        // SEC-022: session persistence is left ON — the record is the only surface that carries the
        // tool calls a run dispatched, and `--no-session-persistence` is what removed it.
        ...(options.sessionLog ? ['--session-log', options.sessionLog] : []),
        ...(options.extraArgs ?? []),
      ];
      const child = spawn(process.execPath, args, {
        cwd: options.cwd,
        env: childEnv,
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', () => {
        // Tool events first, then the stdout-derived ones: in `-p` print mode only the FINAL
        // assistant text reaches stdout, so its `assistant-done` terminates the turn and every tool
        // the record carries ran before it.
        appendRecordedToolEvents(homeDir, readSessionId(stdout), events);
        for (const line of stdout.split('\n')) appendStreamJsonLine(line, events);
        resolve();
      });
    });

  return {
    events,
    async start(): Promise<void> {
      /* no persistent process — each send runs the binary once */
    },
    send: (text: string): Promise<void> => runPrint(text),
    queueUserAction: (): void => {
      /* print mode is non-interactive — there is no ask to pre-answer */
    },
    assistantReplies: (): string[] => readAssistantReplies(events),
    lastAssistantText: (): string | undefined => readLastAssistantText(events),
    toolCalls: () => readToolCalls(events),
    errors: (): Error[] => readErrors(events),
    async stop(): Promise<void> {
      /* nothing to tear down */
    },
  };
}
