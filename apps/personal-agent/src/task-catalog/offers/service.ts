/**
 * The offers the person is shown, and the one door an agent's proposal goes through to become one.
 * A proposal is judged by the host's gate before anything is kept; what is kept is judged again every
 * time it is shown and when the person starts a task from it, since the source, the service or the
 * installed task may have changed. The person can set an offer aside, snooze it or bring it back; an
 * offer is accepted only by the task being started from it, which the launch records here.
 *
 * Offers are shown on the page the person opens, and an offer that fails its gate is simply not shown.
 * The person's own preferences come before the gate: with suggestions off, or a topic or source muted,
 * nothing is proposed, shown or started. A new offer, once and only once and only when its task is ready,
 * may also be handed to the shared delivery, which decides under the person's limits whether it is pushed,
 * held for the digest or left alone; that decision is recorded apart from what the person did with the
 * offer. What an offer says is text from a source and stays text, and only the task's own title is sent.
 */
import { randomUUID } from 'node:crypto';

import { createOfferTools } from '@robota-sdk/agent-product/personal';

import { TaskCatalogRefusedError, asRecord, isoTime, oneOf, rejectUnknownKeys } from '../fields.js';
import { createMemoryDeliveryLog } from './delivery-log.js';
import { judgeProposal, whyNotOffered } from './gate.js';
import { offerInstructions } from './instructions.js';
import {
  changePreferences,
  createMemoryOfferPreferences,
  sourceOf,
  whyHeldBack,
} from './preferences.js';

import type { FunctionTool } from '@robota-sdk/agent-core';
import type {
  IOfferDeliveryInput,
  IOfferProposer,
  TDelivery,
  TOfferProposal,
} from '@robota-sdk/agent-product/personal';
import type { ITaskCatalog } from '../catalog.js';
import type { ILaunchOffers } from '../launch/coordinator.js';
import type { IOffer, IOfferView, ITaskDefinitionListing, TOfferDecision } from '../types.js';
import type { IOfferDeliveryLog, IOfferDeliveryRecord, TDeliveryReason } from './delivery-log.js';
import type { IGateReaders, IProposalContext, TSourceStanding } from './gate.js';
import type {
  IOfferPreferenceStore,
  IOfferPreferences,
  IOfferPreferencesRead,
} from './preferences.js';

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
  /** Whether an offer is open and still shown to the person now; looking records nothing. */
  stillOffered(id: string): Promise<boolean>;
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
  /** What the person chose about offers, as it reads now; unreadable words read as off, with the issue. */
  preferences(): IOfferPreferencesRead;
  /** Change what the person chose: only what the body names, refused whole when any part is not valid. */
  changePreferences(body: unknown): IOfferPreferences;
  /** What became of a new offer as far as telling the person goes; absent when nothing was decided. */
  deliveryOf(id: string): IOfferDeliveryRecord | undefined;
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
  /** The person's words about offers; without them, the defaults, kept in memory. */
  readonly preferences?: IOfferPreferenceStore;
  /** What was decided about telling the person of each new offer; without it, kept in memory. */
  readonly deliveryLog?: IOfferDeliveryLog;
  /** The shared delivery's door for an offer; without it, offers are only ever shown on the page. */
  readonly deliver?: (input: IOfferDeliveryInput) => Promise<TDelivery>;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export function createOfferService(options: IOfferServiceOptions): IOfferService {
  const { catalog } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `offer-${randomUUID().replaceAll('-', '')}`);
  const preferenceStore = options.preferences ?? createMemoryOfferPreferences();
  const deliveryLog = options.deliveryLog ?? createMemoryDeliveryLog();
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

  /** What a proposal answers, and what is left to do for it once proposals are no longer held in line. */
  interface IProposed {
    readonly answer: TOfferProposal;
    readonly after?: () => Promise<void>;
  }

  const propose = async (
    raw: unknown,
    run: { attempts: number; accepted: number } | undefined,
  ): Promise<IProposed> => {
    if (run !== undefined) run.attempts += 1;
    const { preferences } = preferenceStore.read();
    if (!preferences.enabled)
      return {
        answer: {
          status: 'rejected',
          reason: 'The person turned suggestions off. Stop proposing.',
        },
      };
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
    if (!verdict.ok) return { answer: { status: 'rejected', reason: verdict.reason } };
    const definition = (await listing).find((entry) => entry.id === verdict.offer.definitionId);
    const held = whyHeldBack(preferences, {
      category: definition?.category,
      source: sourceOf(verdict.offer),
    });
    if (held !== undefined)
      return {
        answer: { status: 'rejected', reason: `${held} The person does not want this proposed.` },
      };
    // Only an offer no one had made before is told of; a repeat observation never is.
    const fresh = (await catalog.findOffer(verdict.offer.dedupeKey)) === undefined;
    try {
      const stored = await catalog.submitOffer(verdict.offer);
      if (run !== undefined) run.accepted += 1;
      return {
        answer: { status: 'accepted', offerId: stored.id },
        ...(fresh && { after: () => deliverNew(stored, definition, preferences) }),
      };
    } catch (error) {
      if (error instanceof TaskCatalogRefusedError)
        return { answer: { status: 'rejected', reason: error.message } };
      throw error;
    }
  };

  /**
   * Hand a new offer to the shared delivery as the person chose, once. The decision is kept whatever it is,
   * and an offer that has a decision already is never handed over again. Telling the person is never
   * what the proposal depends on: a failure here leaves the offer where every offer is, on the page.
   */
  const deliverNew = async (
    offer: IOffer,
    definition: ITaskDefinitionListing | undefined,
    preferences: IOfferPreferences,
  ): Promise<void> => {
    try {
      if (deliveryLog.find(offer.id) !== undefined) return;
      const decide = (decision: TDelivery, reason: TDeliveryReason): void =>
        deliveryLog.record({ offerId: offer.id, decision, reason, at: now().toISOString() });
      if (preferences.delivery === 'feed') return decide('feed', 'chosen');
      if (options.deliver === undefined) return;
      if (definition?.readiness.state !== 'ready') return decide('feed', 'not-ready');
      try {
        const decision = await options.deliver({
          offerId: offer.id,
          // The task's own title, which the host wrote; nothing the source or the agent said.
          title: definition.title,
          sourceKey: `source:${sourceOf(offer) ?? offer.id}`,
          mode: preferences.delivery,
        });
        decide(
          decision,
          decision === 'notify'
            ? 'pushed'
            : decision === 'digest'
              ? 'held-for-digest'
              : 'not-pushed',
        );
      } catch {
        // allow-fallback: telling the person is extra; the offer is on the page whether or not it was pushed.
        decide('feed', 'failed');
      }
    } catch {
      // allow-fallback: so is keeping the decision; it never fails the proposal that made the offer.
    }
  };

  const proposer = (settings: { readonly perRun?: boolean } = {}): IOfferProposer => {
    const run = settings.perRun === true ? { attempts: 0, accepted: 0 } : undefined;
    return {
      propose: async (candidate) => {
        const proposed = await inOrder(() => propose(candidate, run));
        await proposed.after?.();
        return proposed.answer;
      },
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
    const { offers, issues: kept } = await catalog.listOffers();
    const { preferences, issue } = preferenceStore.read();
    const issues = issue === undefined ? kept : [...kept, issue];
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
      // The person's own words come first: what is off or muted is not shown, whatever its state.
      const unwanted = whyHeldBack(preferences, {
        category: listing.find((entry) => entry.id === offer.definitionId)?.category,
        source: sourceOf(offer),
      });
      if (unwanted !== undefined) continue;
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
      const listing = await catalog.listDefinitions();
      const held = whyHeldBack(preferenceStore.read().preferences, {
        category: listing.find((entry) => entry.id === offer.definitionId)?.category,
        source: sourceOf(offer),
      });
      if (held !== undefined)
        return { ok: false, kind: 'conflict', reason: `${held} This offer cannot be started.` };
      if (offer.decision !== 'open')
        return {
          ok: false,
          kind: 'conflict',
          reason: NOT_OPEN[offer.decision] ?? 'This offer cannot be started.',
        };
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
    stillOffered: async (id) =>
      (await assemble()).offers.some((offer) => offer.id === id && offer.decision === 'open'),
    open: async (id) => {
      const { offers, setAside } = await assemble();
      const found = [...offers, ...setAside].find((offer) => offer.id === id);
      if (found === undefined) return undefined;
      await noteReaction([id], 'shown');
      await noteReaction([id], 'opened');
      return found;
    },
    decide,
    preferences: () => preferenceStore.read(),
    changePreferences: (body) => {
      const next = refused(() => changePreferences(preferenceStore.read().preferences, body));
      preferenceStore.write(next);
      return next;
    },
    deliveryOf: (id) => deliveryLog.find(id),
    launch,
  };
}
