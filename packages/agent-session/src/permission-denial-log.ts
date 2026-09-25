/**
 * The calls this session refused, most recent first, so `/permissions` can show what was blocked
 * and why without the user scrolling back through the transcript (issue #3082).
 *
 * In memory and bounded: it answers "what did I just block", not an audit trail — the
 * `PermissionDecision` hook and the session log are the durable records.
 */

import { getToolPermissionProfile } from '@robota-sdk/agent-core';

import type { TToolArgs } from '@robota-sdk/agent-core';

/**
 * Why a call was refused:
 * - `policy`      — the gate answered deny: a deny rule, a background ceiling, or plan mode;
 * - `user`        — a person was asked and declined, or the turn was cancelled while asking;
 * - `no-approver` — the call needed a person and none was attached;
 * - `classifier`  — in `auto` mode, the classifier blocked the call or gave no usable verdict.
 */
export type TPermissionDenialReason = 'policy' | 'user' | 'no-approver' | 'classifier';

export interface IPermissionDenial {
  readonly toolName: string;
  /** The argument the tool's permission profile names (command, path, URL), when it has one. */
  readonly argument?: string;
  readonly reason: TPermissionDenialReason;
  /** The classifier's reason, for a `classifier` denial. */
  readonly detail?: string;
  /** Epoch milliseconds. */
  readonly at: number;
}

const DEFAULT_CAPACITY = 20;
const ARGUMENT_DISPLAY_LIMIT = 200;

function argumentOf(toolName: string, toolArgs: TToolArgs): string | undefined {
  const key = getToolPermissionProfile(toolName).argument?.key;
  if (key === undefined) return undefined;
  const value = toolArgs[key];
  if (typeof value !== 'string') return undefined;
  return value.length > ARGUMENT_DISPLAY_LIMIT
    ? `${value.slice(0, ARGUMENT_DISPLAY_LIMIT)}…`
    : value;
}

export class PermissionDenialLog {
  private readonly entries: IPermissionDenial[] = [];
  /** The full call behind each entry, same order, so a denial can be retried exactly. */
  private readonly calls: { toolName: string; toolArgs: TToolArgs }[] = [];

  constructor(
    private readonly capacity: number = DEFAULT_CAPACITY,
    private readonly now: () => number = Date.now,
  ) {}

  record(
    toolName: string,
    toolArgs: TToolArgs,
    reason: TPermissionDenialReason,
    detail?: string,
  ): void {
    const argument = argumentOf(toolName, toolArgs);
    this.entries.unshift({
      toolName,
      ...(argument !== undefined ? { argument } : {}),
      reason,
      ...(detail !== undefined ? { detail } : {}),
      at: this.now(),
    });
    this.calls.unshift({ toolName, toolArgs });
    if (this.calls.length > this.capacity) this.calls.length = this.capacity;
    if (this.entries.length > this.capacity) this.entries.length = this.capacity;
  }

  list(): readonly IPermissionDenial[] {
    return [...this.entries];
  }

  /** The call behind the entry at `index` in {@link list}. */
  callAt(index: number): { toolName: string; toolArgs: TToolArgs } | undefined {
    return this.calls[index];
  }
}
