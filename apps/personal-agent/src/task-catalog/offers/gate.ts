/**
 * The host's gate on an offer the agent proposes. It runs when the proposal is made, again whenever the
 * offers are shown and again when the person starts a task from one, and it is a function of what it is
 * given: the proposal, the time it is handed, and readers for what the host can look at (the installed
 * tasks, a connected service, a library page, the cases, the offers kept). It reads no clock and no
 * global, and nothing the agent wrote decides anything but the text it is shown: the reason and the
 * basis are only checked for a secret value and then kept as plain text. A proposal either passes every
 * check or is refused in plain words; the agent cannot argue with a refusal.
 *
 * The source is tied to something the host can look at again. For a connected service the host can say
 * that the service exists and is connected, but it has no cheap way to fetch an item by the agent's own
 * reference, so the item itself is not re-read: the offer rests on the service's state and on how old
 * the observation is. A library page is looked up by its id.
 */
import { createHash } from 'node:crypto';

import {
  TaskCatalogRefusedError,
  asRecord,
  isoTime,
  normalizedReference,
  oneOf,
  positiveInteger,
  rejectUnknownKeys,
  shaped,
  valueLine,
} from '../fields.js';
import { LaunchRefusedError } from '../launch/types.js';
import { OFFER_SOURCE_KINDS } from '../types.js';
import { OFFER_LIMITS } from '../validate-offer.js';

import type {
  IOffer,
  IOfferEvidence,
  ITaskDefinition,
  TOfferDecision,
  TOfferSourceKind,
} from '../types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How old what an offer rests on may be, when it is proposed and every time it is shown or started. */
export const EVIDENCE_MAX_AGE_MS = 14 * DAY_MS;
/** How long an offer the agent made stays open, at most. */
export const OFFER_LIFETIME_MS = 7 * DAY_MS;
/** How long after an offer lapsed unanswered the same source matter makes no new one. */
export const OFFER_COOLDOWN_MS = 3 * DAY_MS;
/** What one run may propose, and how many tries it gets in all, so a run cannot fill the store. */
export const OFFER_PROPOSALS_PER_RUN = 3;
export const OFFER_ATTEMPTS_PER_RUN = 10;
/** How many new offers the agent may make in a day, counted from the offers kept. */
export const OFFER_PROPOSALS_PER_DAY = 5;
/** How far ahead of the host's clock an observation may be dated, for clocks that differ a little. */
export const OBSERVED_SKEW_MS = 5 * 60_000;

export type TSourceStanding = 'connected' | 'not-connected' | 'missing';

/** What the gate can look at; every answer is read afresh and nothing is kept between calls. */
export interface IGateReaders {
  /** The newest revision of every task the catalog holds. */
  definitions(): Promise<readonly ITaskDefinition[]>;
  connector(id: string): Promise<TSourceStanding>;
  libraryPage(id: string): Promise<boolean>;
  /** Whether a case about this item is open, by the connector and the agent's own reference. */
  openCase(connectorId: string | undefined, sourceItemId: string): Promise<boolean>;
  /** The offer kept for a dedupe key as it reads now, or none. */
  offerFor(dedupeKey: string): Promise<IOffer | undefined>;
}

export interface IProposalContext {
  readonly now: Date;
  readonly readers: IGateReaders;
  /** The checks Start makes on a value, run on each suggested one; refuses with a `LaunchRefusedError`. */
  readonly checkInputs: (
    definition: ITaskDefinition,
    suggested: Readonly<Record<string, string>>,
  ) => Readonly<Record<string, string>>;
  readonly counts: {
    /** The proposals this run has made, this one included. */
    readonly attemptsInRun: number;
    /** The proposals this run has had accepted. */
    readonly acceptedInRun: number;
    /** The offers the agent made in the last day. */
    readonly newToday: number;
  };
  readonly newId: () => string;
}

export type TProposalVerdict =
  { readonly ok: true; readonly offer: IOffer } | { readonly ok: false; readonly reason: string };

const CANDIDATE_KEYS = [
  'definitionId',
  'definitionRevision',
  'source',
  'basis',
  'why',
  'suggestedInputs',
];
const SOURCE_KEYS = ['kind', 'connectorId', 'sourceItemId', 'observedAt'];
const DEFINITION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;

/** One key for one source matter: the task, the service and the agent's own reference to the item. */
export function agentOfferKey(definitionId: string, evidence: IOfferEvidence): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        definitionId,
        evidence.kind,
        evidence.connectorId ?? '',
        normalizedReference(evidence.sourceItemId),
      ]),
    )
    .digest('hex');
  return `agent:${digest.slice(0, 40)}`;
}

/**
 * The agent's reference to an item as the host keeps and compares it: judged by the value it carries,
 * then in one spelling, so a variant of the same reference cannot be a different matter. Spelling it
 * out can make it longer, so the bound is checked on what is kept.
 */
function itemReference(value: unknown): string {
  const kept = normalizedReference(
    valueLine(value, 'source.sourceItemId', OFFER_LIMITS.sourceItemId),
  );
  if (kept.length > OFFER_LIMITS.sourceItemId)
    throw new TaskCatalogRefusedError(
      `source.sourceItemId must be at most ${OFFER_LIMITS.sourceItemId} characters`,
    );
  return kept;
}

function parseEvidence(raw: unknown): IOfferEvidence {
  const source = asRecord(raw, 'source');
  rejectUnknownKeys(source, SOURCE_KEYS, 'source');
  const kind: TOfferSourceKind = oneOf(source['kind'], 'source.kind', OFFER_SOURCE_KINDS);
  if (kind === 'connector') {
    if (source['connectorId'] === undefined)
      throw new TaskCatalogRefusedError('source.connectorId is needed for a connected service');
  } else if (source['connectorId'] !== undefined) {
    throw new TaskCatalogRefusedError('source.connectorId belongs to a connected service only');
  }
  if (source['sourceItemId'] === undefined)
    throw new TaskCatalogRefusedError(
      'source.sourceItemId is needed: the reference of the item you read',
    );
  return {
    kind,
    ...(kind === 'connector' && {
      connectorId: shaped(source['connectorId'], 'source.connectorId', CONNECTOR_ID, 80),
    }),
    sourceItemId: itemReference(source['sourceItemId']),
    observedAt: isoTime(source['observedAt'], 'source.observedAt'),
  };
}

function parseSuggested(raw: unknown): Record<string, string> {
  const entries = Object.entries(asRecord(raw, 'suggestedInputs'));
  if (entries.length > OFFER_LIMITS.prefilledEntries)
    throw new TaskCatalogRefusedError(
      `suggestedInputs must have at most ${OFFER_LIMITS.prefilledEntries} entries`,
    );
  const suggested: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (typeof value !== 'string')
      throw new TaskCatalogRefusedError(`suggestedInputs.${name} must be text`);
    suggested[name] = value;
  }
  return suggested;
}

/** Why an observation made now cannot rest on this evidence, or nothing when it is fresh enough. */
function staleness(observedAt: string, now: Date): string | undefined {
  const age = now.getTime() - Date.parse(observedAt);
  if (age < -OBSERVED_SKEW_MS) return 'The observation is dated in the future.';
  if (age >= EVIDENCE_MAX_AGE_MS)
    return 'What this rests on was read too long ago to offer a task for now.';
  return undefined;
}

const sourceMissing = (standing: TSourceStanding): string | undefined =>
  standing === 'missing'
    ? 'That service is not one of the person’s connected services.'
    : standing === 'not-connected'
      ? 'That service is not connected right now, so what it holds cannot be offered on.'
      : undefined;

/** Why the source of an offer can no longer stand behind it, or nothing when it still does. */
async function sourceProblem(
  evidence: IOfferEvidence,
  context: Pick<IProposalContext, 'now' | 'readers'>,
): Promise<string | undefined> {
  const old = staleness(evidence.observedAt, context.now);
  if (old !== undefined) return old;
  if (evidence.kind === 'connector') {
    const standing = sourceMissing(await context.readers.connector(evidence.connectorId!));
    if (standing !== undefined) return standing;
  } else if (!(await context.readers.libraryPage(evidence.sourceItemId))) {
    return 'The library has no such page now.';
  }
  if (await context.readers.openCase(evidence.connectorId, evidence.sourceItemId))
    return 'A case about this item is open, so the person is asked there and not through an offer.';
  return undefined;
}

const DECIDED: Readonly<Partial<Record<TOfferDecision, string>>> = {
  dismissed: 'The person dismissed an offer for this already.',
  accepted: 'The person already started this task from an offer for this item.',
  superseded: 'A newer offer replaced this one.',
};

/**
 * Judge a proposal the agent made. Anything wrong with it, in the shape or in what it names, comes back as
 * the reason, in words the agent can read and the person could; a thing the gate does not know how to
 * judge is not caught here and is left to fail loudly.
 */
export async function judgeProposal(
  raw: unknown,
  context: IProposalContext,
): Promise<TProposalVerdict> {
  try {
    return { ok: true, offer: await judge(raw, context) };
  } catch (error) {
    if (error instanceof TaskCatalogRefusedError || error instanceof LaunchRefusedError)
      return { ok: false, reason: error.message };
    throw error;
  }
}

const refuse = (reason: string): never => {
  throw new TaskCatalogRefusedError(reason);
};

async function judge(raw: unknown, context: IProposalContext): Promise<IOffer> {
  const { now, readers, counts } = context;
  // The run's own bounds come first, so a run that keeps trying costs nothing more than the refusal.
  if (counts.attemptsInRun > OFFER_ATTEMPTS_PER_RUN)
    refuse('This run has proposed as often as it may. Stop proposing.');
  if (counts.acceptedInRun >= OFFER_PROPOSALS_PER_RUN)
    refuse('This run has proposed as many offers as it may. Stop proposing.');
  const candidate = asRecord(raw, 'The proposal');
  rejectUnknownKeys(candidate, CANDIDATE_KEYS, 'The proposal');
  const definitionId = shaped(candidate['definitionId'], 'definitionId', DEFINITION_ID, 60);
  const revision = positiveInteger(candidate['definitionRevision'], 'definitionRevision');
  const installed = await readers.definitions();
  const definition = installed.find((entry) => entry.id === definitionId);
  if (definition === undefined)
    return refuse(
      `No task ${definitionId} is installed, so nothing can be offered for it. Installed tasks: ${installed
        .map((entry) => `${entry.id} (revision ${entry.revision})`)
        .join(', ')}.`,
    );
  if (definition.revision !== revision)
    refuse(
      `Task ${definitionId} is at revision ${definition.revision} now; propose that revision.`,
    );
  const why = valueLine(candidate['why'], 'why', OFFER_LIMITS.reason);
  const basis = valueLine(candidate['basis'], 'basis', OFFER_LIMITS.basis);
  const evidence = parseEvidence(candidate['source']);
  const problem = await sourceProblem(evidence, context);
  if (problem !== undefined) return refuse(problem);
  const suggested =
    candidate['suggestedInputs'] === undefined
      ? undefined
      : context.checkInputs(definition, parseSuggested(candidate['suggestedInputs']));
  const dedupeKey = agentOfferKey(definitionId, evidence);
  const kept = await readers.offerFor(dedupeKey);
  if (kept !== undefined) {
    const decided = DECIDED[kept.decision];
    if (decided !== undefined) return refuse(decided);
    if (
      kept.decision === 'expired' &&
      now.getTime() < Date.parse(kept.expiresAt) + OFFER_COOLDOWN_MS
    )
      refuse('An offer for this item lapsed a short while ago, so it is not made again yet.');
  } else if (counts.newToday >= OFFER_PROPOSALS_PER_DAY) {
    refuse('Enough offers were made in the last day; this one waits.');
  }
  const expires = Math.min(
    now.getTime() + OFFER_LIFETIME_MS,
    Date.parse(evidence.observedAt) + EVIDENCE_MAX_AGE_MS,
  );
  return {
    id: context.newId(),
    definitionId,
    definitionRevision: revision,
    source: 'agent',
    reason: why,
    basis,
    contextRefs: [],
    createdAt: now.toISOString(),
    expiresAt: new Date(expires).toISOString(),
    decision: 'open',
    dedupeKey,
    evidence,
    ...(suggested !== undefined && Object.keys(suggested).length > 0 && { prefilled: suggested }),
  };
}

/** What the gate needs to know about an offer to judge it again: which task, and what it was read from. */
export interface IOfferStanding {
  readonly definitionId: string;
  readonly definitionRevision: number;
  readonly evidence?: IOfferEvidence | undefined;
}

/**
 * Why an offer must not be shown or started now, or nothing when it may: its task is no longer the
 * installed revision, or what it rests on is too old, gone, disconnected or already being asked about.
 * The person's own decision is judged by the caller.
 */
export async function whyNotOffered(
  offer: IOfferStanding,
  context: Pick<IProposalContext, 'now' | 'readers'>,
): Promise<string | undefined> {
  const definition = (await context.readers.definitions()).find(
    (entry) => entry.id === offer.definitionId,
  );
  if (definition === undefined) return 'This task is no longer in your catalog.';
  if (definition.revision !== offer.definitionRevision)
    return 'This offer is for an older version of the task, so it was withdrawn.';
  return offer.evidence === undefined ? undefined : sourceProblem(offer.evidence, context);
}
