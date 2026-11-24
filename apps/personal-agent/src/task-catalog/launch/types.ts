/**
 * The launch intent: the person's one request to run an exact revision of a task with exact inputs.
 * It is kept before any goal exists, so a retry, a second tab or a restart finds the same request and
 * the one goal made for it. It holds what the request rested on (the revision, the values and the
 * bindings the host issued) as plain data, and never a credential.
 */
import type { TBindingAdapter } from '../bindings.js';
import type { TEffectCeiling, TOutcomeState, TReadiness } from '../types.js';

export const LAUNCH_STATUSES = ['reserved', 'launched', 'failed', 'cancelled'] as const;
export type TLaunchStatus = (typeof LAUNCH_STATUSES)[number];

/** Where a launch stands for the person: the live states while its goal is active, else how it ended. */
export type TLaunchProgress = 'starting' | 'running' | 'waiting' | TOutcomeState;

/** The values a task asked for, by input name: plain text or numbers, bounded. */
export type TLaunchInputs = Readonly<Record<string, string | number>>;

/** One binding the host issued for the request, as the data it was: nothing secret and nothing a service said. */
export interface ILaunchBinding {
  readonly capability: string;
  readonly adapter: TBindingAdapter;
  readonly account?: string;
  readonly tool?: string;
  readonly effect: TEffectCeiling;
  readonly argumentBoundary: string;
}

/**
 * How the request began: the person pressing Start on a task's own card, or on an offer, which then
 * names that offer so its outcome can be recorded beside it.
 */
export type TLaunchOrigin =
  { readonly kind: 'manual' } | { readonly kind: 'offer'; readonly offerId: string };

export interface ILaunchFailure {
  /** `stale`: what the request rested on changed before a goal was made. `goal`: the goal could not be made. */
  readonly kind: 'stale' | 'goal';
  /** Plain words for the person; never a path or a service's own text. */
  readonly message: string;
}

/**
 * What the host recorded when its own browser returned a page to a run: the address asked for and the
 * address the page was at, how much text came back, a digest of it, and when. Only the host's browser
 * port makes one, so nothing a model writes or a page says can. The page's text is not kept beyond a
 * short plain excerpt for the person to see.
 */
export interface IEvidenceReceipt {
  readonly kind: 'page-read';
  /** Which of the browser's two reading tools returned the page. */
  readonly tool: 'open' | 'view';
  /** The address the run asked to open; only for `open`. */
  readonly requested?: string;
  /** The address the browser reported the page was at, which differs from `requested` after a redirect. */
  readonly address: string;
  /** How many characters of text came back, ignoring blank space; none means nothing was readable. */
  readonly chars: number;
  /** SHA-256 of the text that came back. */
  readonly digest: string;
  /** The start of the text as plain words, left out when it looks like it carries a secret. */
  readonly excerpt?: string;
  readonly at: string;
}

/** A receipt as kept while its launch waits for an outcome: tied to the run that made it. */
export interface IRunReceipt extends IEvidenceReceipt {
  readonly runId: string;
}

/** How a launched task ended. It is decided once, when its goal ended, and never changes. */
export interface ILaunchOutcome {
  readonly state: TOutcomeState;
  /** Plain words for the person; fixed by the host. */
  readonly reason: string;
  /** What the run read, the reads that match what the task promised first. */
  readonly evidence: readonly IEvidenceReceipt[];
  readonly decidedAt: string;
  /** The run it was decided from; absent when no run was left to read. */
  readonly runId?: string;
  /**
   * That run's report as plain text, bounded: the model's own account, kept with the outcome so the
   * person is shown the report that was judged even after the goal is rerun or removed. Never proof.
   */
  readonly report?: string;
}

export interface ILaunchIntent {
  readonly id: string;
  /** The client's key for this request: one key, one launch. */
  readonly idempotencyKey: string;
  /** What the request asked for, as the client sent it, so the same key with other values is caught. */
  readonly requestDigest: string;
  readonly definitionId: string;
  readonly definitionRevision: number;
  /** A fingerprint of the definition as it was when the request was made. */
  readonly definitionDigest: string;
  /** The values the goal is made from, after checks and defaults. */
  readonly inputs: TLaunchInputs;
  readonly bindings: readonly ILaunchBinding[];
  readonly origin: TLaunchOrigin;
  readonly status: TLaunchStatus;
  /** Present once launched, and only then. */
  readonly goalId?: string;
  /** Present when failed, and only then. */
  readonly failure?: ILaunchFailure;
  /** What the host's browser returned to the goal's runs, kept only until the outcome is decided. */
  readonly receipts?: readonly IRunReceipt[];
  /** Present once the goal ended and the host decided, and only on a launched intent. */
  readonly outcome?: ILaunchOutcome;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An intent as the person's page reads it: without the client's key, the digest of the request, or the host's own bookkeeping. */
export type ILaunchView = Omit<
  ILaunchIntent,
  'idempotencyKey' | 'requestDigest' | 'receipts' | 'outcome'
>;

/** A launch with where it stands: what the person is shown for it, read-only. */
export interface ILaunchStatusView extends ILaunchView {
  readonly progress: TLaunchProgress;
  /** Plain words from the host on why it stands there. */
  readonly reason: string;
  /** The deciding run's report as plain text, bounded: the model's account, never proof. */
  readonly report?: string;
  readonly evidence: readonly IEvidenceReceipt[];
  readonly decidedAt?: string;
}

export interface ILaunchStarted {
  readonly launch: ILaunchView;
  readonly goalId: string;
  /** False when the request had been made before and this answer is its earlier outcome again. */
  readonly created: boolean;
}

/** The ways a start is refused; the API gives each its own status. */
export type TLaunchRefusal =
  'invalid' | 'too-large' | 'unknown' | 'conflict' | 'not-ready' | 'stale' | 'failed';

export class LaunchRefusedError extends Error {
  constructor(
    readonly kind: TLaunchRefusal,
    message: string,
    readonly detail: {
      readonly readiness?: TReadiness;
      readonly launch?: ILaunchView;
    } = {},
  ) {
    super(message);
    this.name = 'LaunchRefusedError';
  }
}
