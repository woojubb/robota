/**
 * The two records the person browses. A task definition is the product's reusable promise of work; an
 * offer is a reason one definition is relevant to this person now. They stay separate so a source can
 * come and go, and an offer can be dismissed or expire, without the definition changing.
 */

export const INPUT_KINDS = ['text', 'choice', 'number'] as const;
export type TInputKind = (typeof INPUT_KINDS)[number];

export const EFFECT_CEILINGS = ['read-only', 'draft', 'approval-required-write'] as const;
export type TEffectCeiling = (typeof EFFECT_CEILINGS)[number];

export const EVIDENCE_KINDS = ['source-readback', 'receipt', 'owner-confirmation'] as const;
export type TEvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const OFFER_SOURCES = ['built-in', 'owner', 'agent'] as const;
export type TOfferSource = (typeof OFFER_SOURCES)[number];

export const OFFER_DECISIONS = ['open', 'dismissed', 'accepted', 'expired', 'superseded'] as const;
export type TOfferDecision = (typeof OFFER_DECISIONS)[number];

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
  readonly decision: TOfferDecision;
  /** One offer per key: a repeat observation updates the offer that has it. */
  readonly dedupeKey: string;
  /** Suggested values for the definition's inputs; the person reads and changes them. */
  readonly prefilled?: Readonly<Record<string, string>>;
}

/** What the host can run now. Only `unavailable` exists until the host verifies a capability binding. */
export interface IReadiness {
  readonly state: 'unavailable';
  readonly reason: string;
}

export interface ITaskDefinitionListing extends ITaskDefinition {
  readonly readiness: IReadiness;
}

/** An offer as the person sees it: no dedupe key, and the definition's title joined in. */
export interface IOfferView extends Omit<IOffer, 'dedupeKey'> {
  /** Absent when the definition revision the offer names is no longer in the catalog. */
  readonly definitionTitle?: string;
  readonly withdrawn: boolean;
}

export interface IOfferListing {
  readonly offers: readonly IOfferView[];
  /** What could not be read from the saved records, in words with no path. */
  readonly issues: readonly string[];
}
