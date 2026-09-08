/**
 * CLI-2004 — the non-visual half of a turn: the bell and the OSC 133 boundary marks.
 *
 * Both are byte-stream events, not rendering, so they live in a hook rather than a component: the
 * App says WHEN a turn starts, ends, or wants an answer, and this decides what reaches the terminal.
 * When the mode is off both writers are inert, so the App has exactly one code path.
 *
 * One turn emits `A` (prompt start) → `B` (prompt end) → `C` (turn start) → `D` (turn end): the
 * prompt is marked while the user is being asked for input, and the execution pair brackets the
 * agent's work. That is the boundary a reader jumps between.
 */

import { useEffect, useMemo, useRef } from 'react';

import { createAttentionBell } from '../attention-bell.js';
import { supportsTurnMarks } from '../terminal-capabilities.js';
import { createTurnMarkWriter } from '../terminal-marks.js';

import type { IAttentionBell } from '../attention-bell.js';
import type { IToolState } from '@robota-sdk/agent-interface-session';

export interface IUseScreenReaderTurnSignalsInputs {
  enabled: boolean;
  /** The agent is working (a turn is in flight). */
  isThinking: boolean;
  /** Tools currently reported as active by the session. */
  activeTools: readonly IToolState[];
  /** A permission ask or user-action dialog is mounted and waiting for an answer. */
  awaitingAnswer: boolean;
}

/**
 * Stable key for one tool run within a turn.
 *
 * `executionId` where the session supplies one; otherwise the position, which `onToolEnd` preserves
 * (it replaces the entry at its index rather than removing it).
 */
function toolKey(tool: IToolState, index: number): string {
  return tool.executionId ?? `${tool.toolName}#${index}`;
}

/** The keys of the tools currently RUNNING — not merely present in the array. */
function runningKeys(activeTools: readonly IToolState[]): Set<string> {
  const running = new Set<string>();
  activeTools.forEach((tool, index) => {
    if (tool.isRunning) running.add(toolKey(tool, index));
  });
  return running;
}

/** Wire the bell and the turn marks to the App's turn lifecycle. */
export function useScreenReaderTurnSignals(inputs: IUseScreenReaderTurnSignalsInputs): void {
  const { enabled, isThinking, activeTools, awaitingAnswer } = inputs;
  const bell = useMemo<IAttentionBell>(() => createAttentionBell({ enabled }), [enabled]);
  const marks = useMemo(
    () => createTurnMarkWriter({ enabled, supported: supportsTurnMarks }),
    [enabled],
  );
  const wasThinking = useRef(false);
  const runningTools = useRef<ReadonlySet<string>>(new Set());

  // Turn boundaries: B/C when work starts, D/A when it ends and the prompt comes back.
  useEffect(() => {
    if (isThinking && !wasThinking.current) {
      marks.emit('promptEnd');
      marks.emit('turnStart');
    } else if (!isThinking && wasThinking.current) {
      marks.emit('turnEnd');
      marks.emit('promptStart');
      bell.replyCompleted();
    }
    wasThinking.current = isThinking;
  }, [isThinking, bell, marks]);

  // The very first prompt of the session is marked once, before anything has been asked.
  useEffect(() => {
    marks.emit('promptStart');
  }, [marks]);

  // A prompt or dialog that wants an answer rings once on mount.
  useEffect(() => {
    if (awaitingAnswer) bell.promptMounted();
  }, [awaitingAnswer, bell]);

  // Long-running tools: record each start, ring on the completions that outlived the threshold.
  //
  // Completion is the `isRunning` true→false transition, NOT the entry leaving the array. The
  // session's `onToolEnd` replaces the finished entry in place (same index, same name, so the same
  // key) and only `onThinking(false)` empties the array — so a membership test would report every
  // tool as completing at turn end, judging its duration against the whole turn.
  useEffect(() => {
    const running = runningKeys(activeTools);
    for (const key of running) {
      if (!runningTools.current.has(key)) bell.toolStarted(key);
    }
    for (const key of runningTools.current) {
      if (!running.has(key)) bell.toolCompleted(key);
    }
    runningTools.current = running;
  }, [activeTools, bell]);
}
