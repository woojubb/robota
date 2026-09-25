/**
 * `auto` permission mode: a model classifier decides the calls the mode itself does not (issue
 * #3082).
 *
 * The permission gate still runs first — deny rules, the ceiling, and the reads and workspace edits
 * the mode approves. What it would have asked a person about goes to the classifier instead, unless
 * the user's own `ask` rule names it. A block returns its reason to the model so it can take another
 * route. When the classifier keeps refusing, the mode pauses and asks a person, because a model
 * that is blocked over and over is either stuck or being steered, and neither is for the classifier
 * to resolve.
 */

import type { TToolArgs } from '@robota-sdk/agent-core';

/** The call the classifier judges. */
export interface IClassifiedCall {
  readonly toolName: string;
  readonly toolArgs: TToolArgs;
  readonly cwd: string;
}

export interface IClassifierVerdict {
  readonly decision: 'allow' | 'block';
  /** Short, for the model and the user: which rule, and why. */
  readonly reason: string;
}

/**
 * Judges one call. `undefined` means no usable verdict (an error, a refusal, output that does not
 * parse): the call is not run. It counts toward a run of refusals, so a classifier that cannot
 * answer hands the decision to a person instead of refusing every call.
 */
export interface IPermissionClassifier {
  classify(call: IClassifiedCall, signal?: AbortSignal): Promise<IClassifierVerdict | undefined>;
}

/** Refusals in a row (blocks or unusable verdicts), and blocks in the session, that pause the mode. */
export const CONSECUTIVE_BLOCK_LIMIT = 3;
export const TOTAL_BLOCK_LIMIT = 20;

/** `reason` is for the user (`/permissions`); `message` is what the model is told. */
export type TAutoModeJudgement =
  | { readonly kind: 'allow' }
  | { readonly kind: 'block'; readonly reason: string; readonly message: string }
  | { readonly kind: 'unusable'; readonly reason: string; readonly message: string };

function callKey(toolName: string, toolArgs: TToolArgs): string {
  return `${toolName}\u0000${JSON.stringify(toolArgs)}`;
}

export class AutoModeGate {
  private consecutive = 0;
  private total = 0;
  private paused = false;
  /** Calls a person allowed to be retried once after the classifier blocked them. */
  private readonly retries = new Set<string>();

  constructor(private readonly classifier: IPermissionClassifier) {}

  /** The mode asks a person until one approves. */
  isPaused(): boolean {
    return this.paused;
  }

  /** A person approved while paused: the classifier decides again. */
  resume(): void {
    this.paused = false;
    this.consecutive = 0;
  }

  /** Let this exact call through once, without the classifier. */
  grantRetry(toolName: string, toolArgs: TToolArgs): void {
    this.retries.add(callKey(toolName, toolArgs));
  }

  /** Consume a retry grant for this exact call, if there is one. */
  takeRetry(toolName: string, toolArgs: TToolArgs): boolean {
    return this.retries.delete(callKey(toolName, toolArgs));
  }

  async judge(call: IClassifiedCall, signal?: AbortSignal): Promise<TAutoModeJudgement> {
    let verdict: IClassifierVerdict | undefined;
    try {
      verdict = await this.classifier.classify(call, signal);
    } catch {
      // allow-fallback: an unusable verdict is a denial that is reported, not a crash
      verdict = undefined;
    }
    if (verdict === undefined) {
      this.consecutive += 1;
      const pause = this.consecutive >= CONSECUTIVE_BLOCK_LIMIT;
      if (pause) this.paused = true;
      return {
        kind: 'unusable',
        reason: 'no usable verdict',
        message:
          'The auto-mode classifier gave no usable verdict, so the call was not run. Try again, ' +
          'or ask the user to approve it.' +
          (pause ? ' Auto mode is paused: the next calls ask the user.' : ''),
      };
    }
    if (verdict.decision === 'allow') {
      this.consecutive = 0;
      return { kind: 'allow' };
    }
    this.consecutive += 1;
    this.total += 1;
    const pause = this.consecutive >= CONSECUTIVE_BLOCK_LIMIT || this.total >= TOTAL_BLOCK_LIMIT;
    if (this.total >= TOTAL_BLOCK_LIMIT) this.total = 0;
    if (pause) this.paused = true;
    return {
      kind: 'block',
      reason: verdict.reason,
      message:
        `Blocked by the auto-mode classifier: ${verdict.reason}. Do not retry the same action; ` +
        'take another approach or ask the user.' +
        (pause ? ' Auto mode is paused after repeated blocks: the next calls ask the user.' : ''),
    };
  }
}
