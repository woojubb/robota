/**
 * What the agent hands the host when it proposes a task offer. The pack owns no catalog: a proposal
 * names a task by id and revision, where the agent saw the reason for it, and why acting may help; the
 * host decides whether it becomes an offer and answers in plain words.
 */

/** Where the agent saw the reason for an offer: a kind, the service and item it came from, and when. */
export interface IOfferSourceRef {
  /** What kind of place it was, such as a connected service; the host decides which kinds it accepts. */
  readonly kind: string;
  readonly connectorId?: string;
  /** The same reference for the same item every time, so one source matter makes one offer. */
  readonly sourceItemId?: string;
  /** When the agent read it, as a UTC time such as 2026-01-31T09:00:00Z. */
  readonly observedAt: string;
}

export interface IOfferCandidate {
  readonly definitionId: string;
  readonly definitionRevision: number;
  readonly source: IOfferSourceRef;
  /** What the source says, as a short factual statement. */
  readonly basis: string;
  /** Why acting now may help the person, in one short sentence. */
  readonly why: string;
  /** Values the person may use to start the task; suggestions only, which the person reads and changes. */
  readonly suggestedInputs?: Readonly<Record<string, string>>;
}

/** The host's answer: the offer that now holds the proposal, or the reason it did not. */
export type TOfferProposal =
  | { readonly status: 'accepted'; readonly offerId: string }
  | { readonly status: 'rejected'; readonly reason: string };

/** The host's side of a proposal. It judges, stores and answers; the agent never sees more than the answer. */
export interface IOfferProposer {
  propose(candidate: IOfferCandidate): Promise<TOfferProposal>;
}
