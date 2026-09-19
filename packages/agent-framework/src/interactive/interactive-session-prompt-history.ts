/**
 * SCREEN-1993 — the session-side append to the prompt-history projection.
 *
 * An injected port called inside the turn path, not a `user_message` subscriber: that event is also
 * emitted for `[remote-control]` notices with no preceding `turn_source`, so a subscriber could not
 * tell a prompt from a notice. Only a turn the owner typed is history — a wake, a peer turn or a
 * remote co-driver's prompt is not — and the recorded text is what was typed, never a skill's
 * synthesized display text.
 */
import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import type {
  IPromptHistoryWriter,
  TDriverId,
  TTurnSource,
} from '@robota-sdk/agent-interface-session';

/** What the surface supplies to turn prompt history on. */
export interface IPromptHistoryOptions {
  readonly writer: IPromptHistoryWriter;
  /** The project key every entry of this session carries (the workspace identity's worktree root). */
  readonly project: string;
}

export interface IPromptRecordInput {
  readonly input: string;
  readonly rawInput: string | undefined;
  readonly turnSource: TTurnSource;
  readonly driverId: TDriverId | undefined;
}

export interface IPromptHistoryRecorderDeps extends IPromptHistoryOptions {
  readonly getSessionId: () => string;
  /** A visible notice into the session's history — used once, on the first failed append. */
  readonly notify: (message: string) => void;
  readonly now?: () => Date;
}

export type TPromptHistoryRecorder = (input: IPromptRecordInput) => void;

/** The same trim `appendPromptHistory` applies in the TUI, so both scopes dedupe identically. */
function typedText(input: IPromptRecordInput): string {
  return (input.rawInput ?? input.input).trim();
}

function isOwnerTurn(input: IPromptRecordInput): boolean {
  return (
    input.turnSource === 'user' &&
    (input.driverId === undefined || input.driverId === OWNER_DRIVER_ID)
  );
}

export function createPromptHistoryRecorder(
  deps: IPromptHistoryRecorderDeps,
): TPromptHistoryRecorder {
  const now = deps.now ?? (() => new Date());
  let last: string | undefined;
  let failureReported = false;
  return (input) => {
    if (!isOwnerTurn(input)) return;
    const text = typedText(input);
    if (text.length === 0 || text === last) return;
    last = text;
    try {
      deps.writer.append({
        at: now().toISOString(),
        sessionId: deps.getSessionId(),
        project: deps.project,
        text,
      });
    } catch (error) {
      // A failed append never aborts the turn; it is reported once, visibly, per session.
      if (failureReported) return;
      failureReported = true;
      const message = error instanceof Error ? error.message : String(error);
      deps.notify(`Prompt history could not be written: ${message}`);
    }
  };
}
