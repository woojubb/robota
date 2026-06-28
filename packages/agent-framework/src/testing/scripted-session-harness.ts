/**
 * TEST-003: framework-level functional session harness.
 *
 * Builds a REAL {@link InteractiveSession} — real agent loop, builtin tools, persistence, events —
 * driven by the deterministic scripted provider (no CLI, no network, no live LLM), in an isolated
 * temp workspace. This is the agent's standard way to prove a framework capability actually works
 * end to end; the CLI is a thin wrapper and must not be the place feature behaviour is verified.
 *
 * The kit is organized for long-term growth: a builder ({@link scriptedSession}), composable
 * drivers ({@link ScriptedSessionHarness.submit}/{@link ScriptedSessionHarness.runGoal}/
 * {@link ScriptedSessionHarness.awaitEvent}), and inspectors (history, session record, files,
 * tool calls, events). New capability drivers/inspectors are added as methods without breaking
 * callers. Exported only via `@robota-sdk/agent-framework/testing`; never import from runtime code.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import {
  createScriptedProvider,
  createReplayProvider,
  createRecordingProvider,
} from '@robota-sdk/agent-core/testing';

import { InteractiveSession } from '../interactive/index.js';
import { createProjectSessionStore } from '../interactive/index.js';

import type { ICommandModule } from '../command-api/index.js';
import type { IAIProvider, TPermissionMode, TUniversalMessage } from '@robota-sdk/agent-core';
import type { TScriptedTurn } from '@robota-sdk/agent-core/testing';
import type {
  ICommandResult,
  IExecutionResult,
  IGoalState,
  IInteractiveSessionEvents,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ITerminalHandoff,
  IToolSummary,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-transport';

/** Options for {@link scriptedSession}. Provide exactly one of `turns`, `cassette`, or `record`. */
export interface IScriptedSessionOptions {
  /** Scripted assistant turns replayed deterministically through the real loop. */
  turns?: readonly TScriptedTurn[];
  /**
   * Path to a recorded cassette (TEST-005). Replays a real model's captured prompts + tool-use
   * deterministically through the real loop. The workspace path is rewritten/scrubbed automatically.
   */
  cassette?: string;
  /**
   * Record mode (TEST-005): drive the session with a REAL provider and capture every interaction to
   * `toCassette` for later deterministic replay. Used in a one-off keyed record run, not in CI.
   */
  record?: { provider: IAIProvider; toCassette: string };
  /** Seed files written into the workspace before the session starts (workspace-relative paths). */
  files?: Record<string, string>;
  /** Persist sessions to a real store in the workspace (enables resume/record assertions). */
  persistence?: boolean;
  /**
   * Reuse an existing workspace directory instead of a fresh temp one. Required for multi-session
   * resume/fork (the resumed session must read the same store). The harness does not delete a
   * workspace it did not create.
   */
  cwd?: string;
  /** Resume a persisted session by id (multi-session). Requires `persistence` + the same `cwd`. */
  resumeSessionId?: string;
  /** Fork the resumed session into a new id while restoring its context (multi-session). */
  forkSession?: boolean;
  /** Command modules composed into the session (e.g. the `/goal` module). */
  commandModules?: readonly ICommandModule[];
  /** Permission posture. Defaults to `bypassPermissions` so tools run unattended. */
  permissionMode?: TPermissionMode;
  /** Pre-approved tool names. */
  allowedTools?: string[];
  /** Denied tool names (deny wins over allow). */
  deniedTools?: string[];
  /** Skip AGENTS.md/CLAUDE.md and plugin discovery for determinism. Defaults to `true`. */
  bare?: boolean;
  /** Cap on agentic rounds per submit. */
  maxTurns?: number;
  /** Model override (e.g. when recording against a real provider whose model differs). */
  model?: string;
  /** TERM-001: inject a (fake) terminal-handoff capability to exercise the handoff orchestration. */
  terminalHandoff?: ITerminalHandoff;
}

const COLLECTED_EVENTS: readonly TInteractiveEventName[] = [
  'text_delta',
  'tool_start',
  'tool_end',
  'thinking',
  'complete',
  'interrupted',
  'error',
  'context_update',
  'goal_event',
  'turn_source',
  'user_message',
];

/**
 * A live, scripted, isolated functional-test session. Construct via {@link scriptedSession};
 * always `await dispose()` in a test teardown.
 */
export class ScriptedSessionHarness {
  /** Absolute path of the isolated temp workspace. */
  readonly cwd: string;
  /** The real session under test. */
  readonly session: InteractiveSession;
  /** Message arrays of every provider chat() call, in order, for request assertions. */
  readonly requests: TUniversalMessage[][];

  private readonly events = new Map<TInteractiveEventName, unknown[][]>();
  private readonly completions: IExecutionResult[] = [];
  private readonly sessionStore?: IInteractiveSessionStore;
  private readonly ownsWorkspace: boolean;
  private disposed = false;

  constructor(options: IScriptedSessionOptions) {
    this.ownsWorkspace = options.cwd === undefined;
    this.cwd = options.cwd ?? mkdtempSync(join(tmpdir(), 'robota-fxn-'));
    if (this.ownsWorkspace) {
      for (const [relPath, content] of Object.entries(options.files ?? {})) {
        const abs = join(this.cwd, relPath);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf8');
      }
    }

    const modes = [options.turns, options.cassette, options.record].filter(
      (mode) => mode !== undefined,
    );
    if (modes.length !== 1) {
      throw new Error('scriptedSession requires exactly one of `turns`, `cassette`, or `record`.');
    }
    let base: IAIProvider;
    if (options.cassette) {
      base = createReplayProvider({
        cassettePath: options.cassette,
        scrub: [this.cwd],
        rewriteCwd: this.cwd,
      });
    } else if (options.record) {
      base = createRecordingProvider({
        provider: options.record.provider,
        cassettePath: options.record.toCassette,
        recordCwd: this.cwd,
      });
    } else {
      base = createScriptedProvider(this.substituteWorkspacePath(options.turns ?? [])).provider;
    }
    // Capture every request uniformly (works for both scripted and cassette providers).
    this.requests = [];
    const provider: IAIProvider = {
      ...base,
      chat: (messages, chatOptions) => {
        this.requests.push([...messages]);
        return base.chat(messages, chatOptions);
      },
    };

    this.sessionStore = options.persistence ? createProjectSessionStore(this.cwd) : undefined;

    this.session = new InteractiveSession({
      cwd: this.cwd,
      provider,
      bare: options.bare ?? true,
      permissionMode: options.permissionMode ?? 'bypassPermissions',
      ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
      ...(options.deniedTools ? { deniedTools: options.deniedTools } : {}),
      ...(this.sessionStore ? { sessionStore: this.sessionStore } : {}),
      ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
      ...(options.forkSession ? { forkSession: options.forkSession } : {}),
      ...(options.commandModules ? { commandModules: options.commandModules } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.terminalHandoff ? { terminalHandoff: options.terminalHandoff } : {}),
    });

    for (const name of COLLECTED_EVENTS) {
      this.session.on(name, ((...args: unknown[]) => {
        this.record(name, args);
        if (name === 'complete' || name === 'interrupted') {
          this.completions.push(args[0] as IExecutionResult);
        }
      }) as IInteractiveSessionEvents[typeof name]);
    }
  }

  /**
   * Replace the `{{cwd}}` placeholder in scripted tool-call args with the isolated workspace path,
   * so a test can reference absolute workspace paths it cannot know until the harness is built
   * (e.g. `{ filePath: '{{cwd}}/out.txt' }` or a Bash `workingDirectory`). Keeps the harness free of
   * global `process.cwd()` mutation.
   */
  private substituteWorkspacePath(turns: readonly TScriptedTurn[]): TScriptedTurn[] {
    return turns.map((turn) => {
      if (!('toolCalls' in turn)) return turn;
      return {
        toolCalls: turn.toolCalls.map((call) => ({
          name: call.name,
          args: JSON.parse(JSON.stringify(call.args).split('{{cwd}}').join(this.cwd)) as Record<
            string,
            unknown
          >,
        })),
      };
    });
  }

  private record(name: TInteractiveEventName, args: unknown[]): void {
    const bucket = this.events.get(name) ?? [];
    bucket.push(args);
    this.events.set(name, bucket);
  }

  // ── Drivers ────────────────────────────────────────────────

  /** Submit a user prompt and resolve with the completed turn result (rejects on `error`). */
  async submit(prompt: string): Promise<IExecutionResult> {
    const settled = this.nextSettledTurn();
    await this.session.submit(prompt);
    return settled;
  }

  /**
   * Assign an autonomous goal and resolve with the FINAL stopped goal state once the loop ends
   * (satisfied or a bound). Rejects if the session emits `error` first.
   */
  async runGoal(objective: string, options: { maxIterations?: number } = {}): Promise<IGoalState> {
    const stopped = new Promise<IGoalState>((resolve, reject) => {
      const onGoal = (event: { type: string; goal: IGoalState }): void => {
        if (event.type !== 'goal_stopped') return;
        cleanup();
        resolve(event.goal);
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        this.session.off('goal_event', onGoal as IInteractiveSessionEvents['goal_event']);
        this.session.off('error', onError);
      };
      this.session.on('goal_event', onGoal as IInteractiveSessionEvents['goal_event']);
      this.session.on('error', onError);
    });
    await this.session.setGoal(
      objective,
      options.maxIterations ? { maxIterations: options.maxIterations } : {},
    );
    return stopped;
  }

  /** Run a slash command through the real session command pipeline. */
  command(name: string, args = ''): Promise<ICommandResult | null> {
    return this.session.executeCommand(name, args);
  }

  /**
   * FLOW-002: inject a background/scheduled wake (a non-user `agent-wakeup` turn) and resolve once
   * that turn settles. Mirrors a background task completion or a scheduled fire re-entering the
   * agent loop. Coalesces by `sourceTaskId` exactly as the real wake path does.
   *
   * Returns `null` when the wake was a no-op (coalesced because `sourceTaskId` is already in flight,
   * or the session is shutting down) — no turn runs, so callers must not await one. This prevents the
   * driver from hanging until the test timeout when the wake is dropped.
   */
  async wake(instruction: string, sourceTaskId: string): Promise<IExecutionResult | null> {
    const queued = this.session.requestWakeup(instruction, sourceTaskId);
    if (!queued) return null;
    return this.nextSettledTurn();
  }

  /** Resolve with the args of the next `event` (optionally matching `predicate`). */
  awaitEvent<E extends TInteractiveEventName>(
    event: E,
    predicate?: (...args: Parameters<IInteractiveSessionEvents[E]>) => boolean,
  ): Promise<Parameters<IInteractiveSessionEvents[E]>> {
    return new Promise((resolve) => {
      const handler = ((...args: unknown[]) => {
        const typed = args as Parameters<IInteractiveSessionEvents[E]>;
        if (predicate && !predicate(...typed)) return;
        this.session.off(event, handler);
        resolve(typed);
      }) as IInteractiveSessionEvents[E];
      this.session.on(event, handler);
    });
  }

  private nextSettledTurn(): Promise<IExecutionResult> {
    return new Promise((resolve, reject) => {
      const onComplete = (result: IExecutionResult): void => {
        cleanup();
        resolve(result);
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        this.session.off('complete', onComplete);
        this.session.off('interrupted', onComplete);
        this.session.off('error', onError);
      };
      this.session.on('complete', onComplete);
      this.session.on('interrupted', onComplete);
      this.session.on('error', onError);
    });
  }

  // ── Inspectors ─────────────────────────────────────────────

  /** The current conversation messages. */
  history(): TUniversalMessage[] {
    return this.session.getMessages();
  }

  /** The persisted session record (requires `persistence: true`), or undefined. */
  sessionRecord(): IInteractiveSessionRecord | undefined {
    if (!this.sessionStore) return undefined;
    return this.sessionStore.load(this.session.getSession().getSessionId());
  }

  /** The real session-log directory the framework writes to (`{cwd}/.robota/logs`). */
  logsDir(): string {
    return join(this.cwd, '.robota', 'logs');
  }

  /** Path of the real JSONL transcript the framework writes for this session. */
  transcriptPath(): string {
    return join(this.logsDir(), `${this.session.getSession().getSessionId()}.jsonl`);
  }

  /** Raw contents of the real session transcript (`''` if none was written). */
  transcript(): string {
    const path = this.transcriptPath();
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  /**
   * The real session transcript parsed into structured log entries — the durable record the
   * framework itself writes (`{ timestamp, sessionId, event, ... }` per line). Leverages the
   * system's own logging as a verification surface, not just in-memory state.
   */
  logEntries(): Array<Record<string, unknown>> {
    return this.transcript()
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** Every tool call the agent made across all completed turns, in order. */
  toolCalls(): IToolSummary[] {
    return this.completions.flatMap((result) => result.toolSummaries);
  }

  /** Raw collected args of each emission of `event`. */
  emittedEvents<E extends TInteractiveEventName>(
    event: E,
  ): Array<Parameters<IInteractiveSessionEvents[E]>> {
    return (this.events.get(event) ?? []) as Array<Parameters<IInteractiveSessionEvents[E]>>;
  }

  /** Read a workspace file (UTF-8). */
  readFile(relPath: string): string {
    return readFileSync(join(this.cwd, relPath), 'utf8');
  }

  /** Whether a workspace file exists. */
  exists(relPath: string): boolean {
    return existsSync(join(this.cwd, relPath));
  }

  /** List workspace files (relative paths), excluding the `.robota` session/log dir. */
  files(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.robota') continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else out.push(relative(this.cwd, abs).split(sep).join('/'));
      }
    };
    walk(this.cwd);
    return out.sort();
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Shut the session down and remove the temp workspace. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.session.shutdown({ reason: 'other', message: 'functional test complete' });
    // Only remove a workspace this harness created — a shared/injected `cwd` (resume/fork) is the
    // caller's to clean up. `maxRetries` rides out the occasional ENOTEMPTY race when a just-written
    // file (e.g. a tool wrote into the workspace) is still settling at teardown.
    if (this.ownsWorkspace) {
      rmSync(this.cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }
}

/** Build a live, isolated, scripted functional-test session (TEST-003). */
export function scriptedSession(options: IScriptedSessionOptions): ScriptedSessionHarness {
  return new ScriptedSessionHarness(options);
}
