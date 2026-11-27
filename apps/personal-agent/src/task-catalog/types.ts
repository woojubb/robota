/**
 * The two records the person browses. A task definition is the product's reusable promise of work; an
 * offer is a reason one definition is relevant to this person now. They stay separate so a source can
 * come and go, and an offer can be dismissed or expire, without the definition changing.
 */
import type { TConnectorKind } from '@robota-sdk/agent-product/personal';

export const INPUT_KINDS = ['text', 'choice', 'number'] as const;
export type TInputKind = (typeof INPUT_KINDS)[number];

/** What work may do, from the least to the most: the position in this list is the only ordering of effects. */
export const EFFECT_CEILINGS = ['read-only', 'draft', 'approval-required-write'] as const;
export type TEffectCeiling = (typeof EFFECT_CEILINGS)[number];

export const EVIDENCE_KINDS = ['source-readback', 'receipt', 'owner-confirmation'] as const;
export type TEvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** How a launched task ended, as the host decided it from what it recorded, never from what the model said. */
export const OUTCOME_STATES = ['verified', 'unverified', 'failed', 'cancelled'] as const;
export type TOutcomeState = (typeof OUTCOME_STATES)[number];

export const OFFER_SOURCES = ['built-in', 'owner', 'agent'] as const;
export type TOfferSource = (typeof OFFER_SOURCES)[number];

/**
 * What the person decided about an offer, or how it ended. `snoozed` hides an offer until its
 * `snoozedUntil`; `accepted` is reached only by starting the task from the offer, never by a decision
 * the person sends.
 */
export const OFFER_DECISIONS = [
  'open',
  'snoozed',
  'dismissed',
  'accepted',
  'expired',
  'superseded',
] as const;
export type TOfferDecision = (typeof OFFER_DECISIONS)[number];

/** Where an agent offer's reason was read, which the host can look at again: a connected service, or a library page. */
export const OFFER_SOURCE_KINDS = ['connector', 'library'] as const;
export type TOfferSourceKind = (typeof OFFER_SOURCE_KINDS)[number];

export interface ITaskInput {
  readonly name: string;
  readonly label: string;
  readonly kind: TInputKind;
  readonly required: boolean;
  /** A text, the one of `choices` a choice starts on, or a number. */
  readonly default?: string | number;
  /** Present for, and only for, a choice. */
  readonly choices?: readonly string[];
}

export interface ITaskDefinition {
  /** Stable across revisions. */
  readonly id: string;
  /** A published revision never changes; a change is a new revision. */
  readonly revision: number;
  readonly title: string;
  readonly category: string;
  readonly expectedResult: string;
  readonly inputs: readonly ITaskInput[];
  /** Semantic operations such as `mail.search`, never the name of a tool a service happens to offer. */
  readonly capabilities: readonly string[];
  /** The most the work may do; each consequential action still waits for the person's approval. */
  readonly effectCeiling: TEffectCeiling;
  /** How success is checked, as a rule: a model's own report is not evidence. */
  readonly completionEvidence: {
    readonly kind: TEvidenceKind;
    readonly description: string;
  };
  readonly execution: 'one-shot';
}

/** Where an offer's reason came from: a kind and an opaque id, never the source's own text. */
export interface IOfferContextRef {
  readonly kind: string;
  readonly id: string;
}

/** The item an agent offer rests on, as the host checked it when the offer was made and checks it again when it is shown. */
export interface IOfferEvidence {
  readonly kind: TOfferSourceKind;
  /** The service the item was read from; present for, and only for, a connector. */
  readonly connectorId?: string;
  /** The agent's own stable reference to the item: for a connector what its case would be called, for the library a page id. */
  readonly sourceItemId: string;
  /** When the agent read it, which only a repeat observation moves. */
  readonly observedAt: string;
}

/**
 * What the person did with an offer and how it turned out, kept apart so that accepting is never
 * counted as success: each is a time the host recorded the first time it happened (the last time for
 * dismissed and snoozed), and `outcome` is how the launched task ended, whatever it was.
 */
export interface IOfferReactions {
  readonly shown?: string;
  readonly opened?: string;
  readonly accepted?: string;
  readonly started?: string;
  /** Present only for a task whose result the host checked. */
  readonly verified?: string;
  readonly dismissed?: string;
  readonly snoozed?: string;
  readonly outcome?: { readonly state: TOutcomeState; readonly at: string };
}

export interface IOffer {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionRevision: number;
  readonly source: TOfferSource;
  /** Plain text for the person to read. It may come from a source, so it is data and nothing else. */
  readonly reason: string;
  readonly contextRefs: readonly IOfferContextRef[];
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The person's decision; an observation never sets it, so a new offer is always stored open. */
  readonly decision: TOfferDecision;
  /** One offer per key: a repeat observation updates the offer that has it. */
  readonly dedupeKey: string;
  /** Suggested values for the definition's inputs; the person reads and changes them. */
  readonly prefilled?: Readonly<Record<string, string>>;
  /** What the source says, as a short factual statement; plain text for the person to read, and data. */
  readonly basis?: string;
  /** Present on an offer the agent made from something it read. */
  readonly evidence?: IOfferEvidence;
  /** Present on a snoozed offer, and only then: when it comes back. */
  readonly snoozedUntil?: string;
  /** Present on an accepted offer that was started: the launch it made. */
  readonly launchId?: string;
  /** Host bookkeeping the person's decision never touches. */
  readonly reactions?: IOfferReactions;
}

/** One thing the person does to move a task from needing setup to ready, named exactly. */
export type TSetupStep =
  | { readonly type: 'connect'; readonly kind: TConnectorKind }
  | {
      readonly type: 'choose-account';
      readonly accounts: readonly { readonly id: string; readonly title: string }[];
    }
  | {
      readonly type: 'allow-tool';
      readonly connectorId: string;
      readonly connectorTitle: string;
      readonly tool: string;
      /** What the person's decision for the tool has to be: `read`, or `write` for a tool that changes something. */
      readonly decision: 'read' | 'write';
    }
  | { readonly type: 'reconnect'; readonly connectorId: string; readonly connectorTitle: string };

/**
 * Whether the host can run a task now, from what it has verified and what the person has set up:
 * `ready` with the kinds of access it would use, `needs-setup` with the steps that remain, or
 * `unavailable` with why the host cannot run it at all.
 */
export type TReadiness =
  | { readonly state: 'ready'; readonly accesses: readonly string[] }
  | { readonly state: 'needs-setup'; readonly steps: readonly TSetupStep[] }
  | { readonly state: 'unavailable'; readonly reason: string };

export interface ITaskDefinitionListing extends ITaskDefinition {
  readonly readiness: TReadiness;
  /** Whether the host has a way to start this task at all; a task that is not ready but startable waits for setup. */
  readonly startable: boolean;
}

/**
 * An offer as the person sees it: no dedupe key or host bookkeeping, the definition's title joined in,
 * and what the host judged about the task when the list was made. Every text in it came from a source,
 * so it is shown as text and nothing else.
 */
export interface IOfferView extends Omit<IOffer, 'dedupeKey' | 'reactions' | 'evidence'> {
  /** Absent when the definition revision the offer names is no longer in the catalog. */
  readonly definitionTitle?: string;
  readonly withdrawn: boolean;
  /** Where the reason was read and when, with the title the person gave the service. */
  readonly evidence?: IOfferEvidence & { readonly connectorTitle?: string };
  /** How the host judges the task now; an offer for a task that is not ready shows it and has no Start. */
  readonly readiness?: TReadiness;
}

export interface IOfferListing {
  readonly offers: readonly IOfferView[];
  /** What could not be read from the saved records, in words with no path. */
  readonly issues: readonly string[];
}
