/**
 * The contracts the execution controller is driven through.
 *
 * Split out of `interactive-session-execution-controller.ts` because that file grew past its frozen
 * size baseline while this change was in review, and `scan-file-size.mjs` says what to do about
 * that: "pre-existing debt may shrink but never grow — split instead of extending." Raising the
 * baseline would have been the other option and is the one the ratchet exists to refuse.
 *
 * The seam is not arbitrary. These three describe what a CALLER supplies and what a submission
 * CARRIES; the class beside them describes what the controller DOES with those. The same split this
 * change already made for `turn-contracts.ts` one package over.
 */

import type { IMemoryEvent } from '../memory/automatic-memory-types.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';
import type { IContextWindowState } from '@robota-sdk/agent-core';
import type {
  IExecutionWorkspaceSnapshot,
  ISubmitOptions,
  ITurnHandle,
  TTurnSource,
} from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

export interface IExecutionControllerCallbacks {
  getSession: () => Session;
  getSessionOrThrow: () => Session;
  getCwd: () => string;
  getProjectAccess: () => TWorkspaceProjectAccess;
  getContextState: () => IContextWindowState;
  getExecutionWorkspaceSnapshot: () => IExecutionWorkspaceSnapshot;
  emit: <E extends string>(event: E, ...args: unknown[]) => void;
  persistSession: () => void;
  /**
   * SELFHOST-008 P2: optional post-turn auto-capture. When set (surface supplied `automaticMemory`), it is
   * `await`ed in the executePrompt `finally` immediately BEFORE `persistSession()` on the completed-turn path,
   * so the returned `IMemoryEvent`s (recorded via the history tracker) land in THIS turn's persisted record.
   * Absent ⇒ capture OFF. It extracts/evaluates/curates through the injected `IMemoryStore` and returns the
   * events; the controller records them + swallows any error to a skip (a capture bug never breaks the turn).
   */
  captureMemory?: (input: {
    userMessage: string;
    assistantMessage: string;
  }) => Promise<IMemoryEvent[]>;
  /**
   * SELFHOST-008 P3: optional per-turn recall. When set (surface supplied a `recallMemory` policy), it is
   * called at turn START with the turn's input and returns a rendered `<recalled-memory>` block (or '') to
   * inject EPHEMERALLY into that turn's model call (never persisted). Absent ⇒ recall OFF (startup-only
   * injection). The controller guards this call — a recall failure skips injection, never breaks the turn.
   */
  recallMemory?: (query: string) => Promise<string>;
}

/** Options threaded through submit/executePrompt for non-user turns (FLOW-002). */
export interface ITurnOptions extends ISubmitOptions {
  turnSource?: TTurnSource;
  /** When set, the in-flight wake for this background task id is cleared on turn completion. */
  wakeTaskId?: string;
}

/** REMOTE-014 E5: one queued input awaiting its turn (attributed). */
export interface IQueuedInput {
  readonly input: string;
  readonly displayInput?: string;
  readonly rawInput?: string;
  readonly options: ITurnOptions;
  /** RUNTIME-006: this already-accepted submission's identity. Every terminal path settles by it. */
  readonly turnId: string;
}

/**
 * A submit callback that optionally carries turn options (default = user turn).
 *
 * RUNTIME-003: the handle comes back and this callback's callers do not read it — the drain
 * re-submits an input whose handle its original submitter already holds. Not reading a value is not
 * a reason to declare that it might not exist: `| void` was the old `Promise<void>` signature left
 * behind by this change, and it described a submission that answers with nothing, which no longer
 * happens on either path. Review found it. An ignored return is the caller's business; a wider type
 * is everyone's.
 */
export type TSubmitFn = (
  prompt: string,
  displayInput?: string,
  rawInput?: string,
  options?: ISubmitOptions,
) => Promise<ITurnHandle>;

/** RUNTIME-006: resume one complete already-accepted queue entry without re-entering public submit. */
export type TResumeQueuedTurnFn = (entry: IQueuedInput) => Promise<void>;
