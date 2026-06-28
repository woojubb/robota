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
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  readAssistantReplies,
  readErrors,
  readLastAssistantText,
  readToolCalls,
} from '@robota-sdk/agent-interface-transport';

import type { IAgentDriver, InteractionEvent } from '@robota-sdk/agent-interface-transport';

const DEFAULT_BIN = fileURLToPath(new URL('../../bin/robota.cjs', import.meta.url));

export interface ICreateBinaryAgentDriverOptions {
  /** Working directory the binary runs in (a provider profile + cwd-scoped sessions live here). */
  cwd: string;
  /** Path to the built robota CLI (defaults to this package's `bin/robota.cjs`). */
  binPath?: string;
  /** Recorded session log for deterministic replay (`--session-log`); no model key is used. */
  sessionLog?: string;
  /** Extra environment for the child (PATH/HOME are supplied by default). */
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

export function createBinaryAgentDriver(options: ICreateBinaryAgentDriverOptions): IAgentDriver {
  const events: InteractionEvent[] = [];
  const binPath = options.binPath ?? DEFAULT_BIN;

  const runPrint = (text: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      events.push({ type: 'user-message', text });
      const args = [
        binPath,
        '-p',
        text,
        '--output-format',
        'stream-json',
        '--no-session-persistence',
        ...(options.sessionLog ? ['--session-log', options.sessionLog] : []),
        ...(options.extraArgs ?? []),
      ];
      const child = spawn(process.execPath, args, {
        cwd: options.cwd,
        env: options.env ?? {
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? '',
        },
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', () => {
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
    queueAction: (): void => {
      /* print mode is non-interactive — there is no requestAction to pre-answer */
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
