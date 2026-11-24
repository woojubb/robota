/**
 * The offers the person is shown, and the one door an agent's proposal goes through to become one.
 * A proposal is judged by the host's gate before anything is kept; what is kept is judged again every
 * time it is shown and when the person starts a task from it, since the source, the service or the
 * installed task may have changed. The person can set an offer aside, snooze it or bring it back; an
 * offer is accepted only by the task being started from it, which the launch records here.
 *
 * Nothing here sends anything: offers are shown on the page the person opens, and an offer that fails
 * its gate is simply not shown. What an offer says is text from a source and stays text.
 */
import { randomUUID } from 'node:crypto';

import { createOfferTools } from '@robota-sdk/agent-product/personal';

import { TaskCatalogRefusedError, asRecord, isoTime, oneOf, rejectUnknownKeys } from '../fields.js';
import { judgeProposal, whyNotOffered } from './gate.js';
import { offerInstructions } from './instructions.js';

import type { FunctionTool } from '@robota-sdk/agent-core';
import type { IOfferProposer, TOfferProposal } from '@robota-sdk/agent-product/personal';
import type { ITaskCatalog } from '../catalog.js';
import type { ILaunchOffers } from '../launch/coordinator.js';
import type { IOfferView, TOfferDecision } from '../types.js';
import type { IGateReaders, IProposalContext, TSourceStanding } from './gate.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead a snooze may reach. */
export const SNOOZE_MAX_MS = 30 * DAY_MS;

/** The decisions the person may send; accepting is the start of the task, and nothing the person sends. */
const PERSON_DECISIONS = ['dismissed', 'snoozed', 'open'] as const;

/** From which state each decision may be asked, as the offer reads now. */
const MAY_MOVE_FROM: Readonly<
  Record<(typeof PERSON_DECISIONS)[number], readonly TOfferDecision[]>
> = {
  dismissed: ['open', 'snoozed', 'dismissed'],
  snoozed: ['open', 'snoozed'],
  open: ['dismissed', 'snoozed', 'open'],
};

const NOT_OPEN: Readonly<Partial<Record<TOfferDecision, string>>> = {
  snoozed: 'You set this offer aside until later. Bring it back to start it.',
  dismissed: 'You dismissed this offer. Bring it back to start it.',
  accepted: 'This offer was already started.',
  expired: 'This offer has expired.',
  superseded: 'A newer offer replaced this one.',
};

export class OfferRefusedError extends Error {
  constructor(
    readonly kind: 'invalid' | 'unknown' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'OfferRefusedError';
  }
}

/** What the page is shown: the offers it may act on, and the ones the person set aside and can bring back. */
export interface IOffersShown {
  readonly offers: readonly IOfferView[];
  readonly setAside: readonly IOfferView[];
  readonly issues: readonly string[];
}

export interface IOfferService {
  /**
   * The port the agent's tool hands a proposal to. With `perRun`, the proposer keeps that run's own
   * count and stops it at the run's bound; without, only the day's bound applies.
   */
  proposer(options?: { readonly perRun?: boolean }): IOfferProposer;
  /** The proposal tool for one run, with that run's own bounds, to stand in for the agent's own. */
  runTools(): FunctionTool[];
  /** What a run that may propose is told about the tasks it can propose, from the host's own list. */
  instructions(): Promise<string>;
  /** The offers to show, which also records that they were shown. */
  list(): Promise<IOffersShown>;
  /** One offer the person may act on, recording that it was opened; absent when it is not one. */
  open(id: string): Promise<IOfferView | undefined>;
  /** Dismiss, snooze or bring back an offer. The body is checked strictly; an offer is never accepted this way. */
  decide(
    id: string,
    body: unknown,
  ): Promise<{
    readonly id: string;
    readonly decision: TOfferDecision;
    readonly snoozedUntil?: string;
  }>;
  /** What a launch asks of its offer, and tells it. */
  readonly launch: ILaunchOffers;
}

export interface IOfferServiceOptions {
  readonly catalog: ITaskCatalog;
  readonly readers: {
    connector(id: string): Promise<TSourceStanding>;
    connectorTitle(id: string): Promise<string | undefined>;
    libraryPage(id: string): Promise<boolean>;
    openCase(connectorId: string | undefined, sourceItemId: string): Promise<boolean>;
  };
  /** The checks Start makes on a value, for the values an offer suggests. */
  readonly checkInputs: IProposalContext['checkInputs'];
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export function createOfferService(options: IOfferServiceOptions): IOfferService {
  const { catalog } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `offer-${randomUUID().replaceAll('-', '')}`);
  /** One proposal at a time, so the day's count and the store never disagree about what came first. */
  let tail: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };

  /** Readers for one piece of work: what is asked twice in it is read once. */
  const readersFor = (definitions: IGateReaders['definitions']): IGateReaders => {
    const standing = new Map<string, Promise<TSourceStanding>>();
    return {
      definitions,
      connector: (id) => {
        const known = standing.get(id) ?? options.readers.connector(id);
        standing.set(id, known);
        return known;
      },
      libraryPage: options.readers.libraryPage,
      openCase: options.readers.openCase,
      offerFor: (key) => catalog.findOffer(key),
    };
  };

  const propose = async (
    raw: unknown,
    run: { attempts: number; accepted: number } | undefined,
  ): Promise<TOfferProposal> => {
    if (run !== undefined) run.attempts += 1;
    const at = now();
    const listing = catalog.listDefinitions();
    const { offers } = await catalog.listOffers();
    const since = at.getTime() - DAY_MS;
    const verdict = await judgeProposal(raw, {
      now: at,
      readers: readersFor(() => listing),
      checkInputs: options.checkInputs,
      counts: {
        attemptsInRun: run?.attempts ?? 0,
        acceptedInRun: run?.accepted ?? 0,
        newToday: offers.filter(
          (offer) => offer.source === 'agent' && Date.parse(offer.createdAt) > since,
        ).length,
      },
      newId,
    });
    if (!verdict.ok) return { status: 'rejected', reason: verdict.reason };
    try {
      const stored = await catalog.submitOffer(verdict.offer);
      if (run !== undefined) run.accepted += 1;
      return { status: 'accepted', offerId: stored.id };
    } catch (error) {
      if (error instanceof TaskCatalogRefusedError)
        return { status: 'rejected', reason: error.message };
      throw error;
    }
  };

  const proposer = (settings: { readonly perRun?: boolean } = {}): IOfferProposer => {
    const run = settings.perRun === true ? { attempts: 0, accepted: 0 } : undefined;
    return {
      propose: (candidate) => inOrder(() => propose(candidate, run)),
    };
  };

  /**
   * The offers as the person may see them, each judged by the gate again now: open ones that still
   * pass, started ones until they lapse, and the ones set aside. An offer the gate holds back, or whose
   * time is over, is not shown.
   */
  const assemble = async (): Promise<IOffersShown> => {
    const at = now();
    const listing = await catalog.listDefinitions();
    const readers = readersFor(async () => listing);
    const { offers, issues } = await catalog.listOffers();
    const titles = new Map<string, Promise<string | undefined>>();
    const titleOf = (id: string): Promise<string | undefined> => {
      const known = titles.get(id) ?? options.readers.connectorTitle(id);
      titles.set(id, known);
      return known;
    };
    const decorate = async (offer: IOfferView, ready: boolean): Promise<IOfferView> => {
      const connectorTitle =
        offer.evidence?.connectorId === undefined
          ? undefined
          : await titleOf(offer.evidence.connectorId);
      const readiness = ready
        ? listing.find((entry) => entry.id === offer.definitionId)?.readiness
        : undefined;
      return {
        ...offer,
        ...(offer.evidence !== undefined && {
          evidence: {
            ...offer.evidence,
            ...(connectorTitle !== undefined && { connectorTitle }),
          },
        }),
        ...(readiness !== undefined && { readiness }),
      };
    };
    const shown: IOfferView[] = [];
    const setAside: IOfferView[] = [];
    for (const offer of offers) {
      if (offer.withdrawn || Date.parse(offer.expiresAt) <= at.getTime()) continue;
      if (offer.decision === 'open') {
        if ((await whyNotOffered(offer, { now: at, readers })) === undefined)
          shown.push(await decorate(offer, true));
      } else if (offer.decision === 'accepted') {
        shown.push(await decorate(offer, false));
      } else if (offer.decision === 'dismissed' || offer.decision === 'snoozed') {
        setAside.push(await decorate(offer, false));
      }
    }
    return { offers: shown, setAside, issues };
  };

  /** Keeping that an offer was seen never fails what showed it. */
  const noteReaction = async (ids: readonly string[], kind: 'shown' | 'opened'): Promise<void> => {
    if (ids.length === 0) return;
    try {
      await catalog.recordOfferReaction(ids, { kind });
    } catch {
      // allow-fallback: a reaction is the host's own bookkeeping; the person is shown the offers either way.
    }
  };

  const refused = <T>(check: () => T): T => {
    try {
      return check();
    } catch (error) {
      if (error instanceof TaskCatalogRefusedError)
        throw new OfferRefusedError('invalid', error.message);
      throw error;
    }
  };

  const decide: IOfferService['decide'] = async (id, body) => {
    const request = refused(() => {
      const record = asRecord(body, 'The decision');
      rejectUnknownKeys(record, ['decision', 'snoozedUntil'], 'The decision');
      return {
        decision: oneOf(record['decision'], 'decision', PERSON_DECISIONS),
        snoozedUntil: record['snoozedUntil'],
      };
    });
    const at = now();
    let snoozedUntil: string | undefined;
    if (request.decision === 'snoozed') {
      snoozedUntil = refused(() => isoTime(request.snoozedUntil, 'snoozedUntil'));
      const wait = Date.parse(snoozedUntil) - at.getTime();
      if (wait <= 0) throw new OfferRefusedError('invalid', 'snoozedUntil must be in the future');
      if (wait > SNOOZE_MAX_MS)
        throw new OfferRefusedError('invalid', 'snoozedUntil must be within 30 days');
    } else if (request.snoozedUntil !== undefined) {
      throw new OfferRefusedError('invalid', 'snoozedUntil belongs to a snooze, and only to one');
    }
    const current = await catalog.getOffer(id);
    if (current === undefined) throw new OfferRefusedError('unknown', 'There is no such offer.');
    if (!MAY_MOVE_FROM[request.decision].includes(current.decision))
      throw new OfferRefusedError(
        'conflict',
        current.decision === 'accepted'
          ? 'This offer was already started.'
          : current.decision === 'expired'
            ? 'This offer has expired.'
            : 'This offer cannot be changed.',
      );
    // The same answer again is the offer as it stands, so a double click keeps the first time.
    if (request.decision === current.decision && request.decision !== 'snoozed')
      return { id, decision: current.decision };
    const stored = await catalog.setOfferDecision(id, request.decision, {
      ...(snoozedUntil !== undefined && { snoozedUntil }),
    });
    return {
      id,
      decision: stored.decision,
      ...(stored.snoozedUntil !== undefined && { snoozedUntil: stored.snoozedUntil }),
    };
  };

  const launch: ILaunchOffers = {
    admit: async (offerId, definition) => {
      const offer = await catalog.getOffer(offerId);
      if (offer === undefined)
        return { ok: false, kind: 'unknown', reason: 'There is no such offer.' };
      if (offer.definitionId !== definition.id)
        return { ok: false, kind: 'invalid', reason: 'This offer is for another task.' };
      if (offer.decision !== 'open')
        return {
          ok: false,
          kind: 'conflict',
          reason: NOT_OPEN[offer.decision] ?? 'This offer cannot be started.',
        };
      const listing = await catalog.listDefinitions();
      const why = await whyNotOffered(offer, {
        now: now(),
        readers: readersFor(async () => listing),
      });
      return why === undefined ? { ok: true } : { ok: false, kind: 'conflict', reason: why };
    },
    accepted: async (offerId, launchId) => {
      await catalog.acceptOffer(offerId, launchId);
    },
    started: (offerId) => catalog.recordOfferReaction([offerId], { kind: 'started' }),
    outcome: (offerId, state) => catalog.recordOfferReaction([offerId], { kind: 'outcome', state }),
  };

  return {
    proposer,
    runTools: () => createOfferTools(proposer({ perRun: true })),
    instructions: async () => offerInstructions(await catalog.listDefinitions()),
    list: async () => {
      const shown = await assemble();
      await noteReaction(
        shown.offers.filter((offer) => offer.decision === 'open').map((offer) => offer.id),
        'shown',
      );
      return shown;
    },
    open: async (id) => {
      const { offers, setAside } = await assemble();
      const found = [...offers, ...setAside].find((offer) => offer.id === id);
      if (found === undefined) return undefined;
      await noteReaction([id], 'shown');
      await noteReaction([id], 'opened');
      return found;
    },
    decide,
    launch,
  };
}
