/**
 * The launch intent: the person's one request to run an exact revision of a task with exact inputs.
 * It is kept before any goal exists, so a retry, a second tab or a restart finds the same request and
 * the one goal made for it. It holds what the request rested on (the revision, the values and the
 * bindings the host issued) as plain data, and never a credential.
 */
import type { TBindingAdapter } from '../bindings.js';
import type { TEffectCeiling, TReadiness } from '../types.js';

export const LAUNCH_STATUSES = ['reserved', 'launched', 'failed', 'cancelled'] as const;
export type TLaunchStatus = (typeof LAUNCH_STATUSES)[number];

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

/** How the request began. Only the person pressing Start in Browse, for now. */
export type TLaunchOrigin = { readonly kind: 'manual' };

export interface ILaunchFailure {
  /** `stale`: what the request rested on changed before a goal was made. `goal`: the goal could not be made. */
  readonly kind: 'stale' | 'goal';
  /** Plain words for the person; never a path or a service's own text. */
  readonly message: string;
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
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An intent as the person's page reads it: without the client's key or the digest of the request. */
export type ILaunchView = Omit<ILaunchIntent, 'idempotencyKey' | 'requestDigest'>;

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
