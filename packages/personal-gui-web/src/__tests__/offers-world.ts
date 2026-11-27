/**
 * A stand-in for the agent's side of the offers, for the page tests: it keeps the offers the way the
 * agent does (open and started ones listed, dismissed and snoozed ones apart, the readiness only on an
 * open one) and answers a decision or a start by moving the offer, so a test sees the lists follow.
 */
import { vi } from 'vitest';

import type { Mock } from 'vitest';
import type {
  IPersonalApi,
  ITaskDefinitionView,
  ITaskLaunchStatusView,
  ITaskOfferDecisionView,
  ITaskOfferView,
  ITaskOffersView,
  ITaskStartAnswer,
  TTaskOfferDecisionRequest,
} from '../api.js';

export const PAGE = 'https://example.com/pricing';
export const QUESTION = 'Does the page say shipping is free?';

export const READY = {
  state: 'ready',
  accesses: ["https pages the person names, read in the agent's own browser; nothing is submitted"],
} as const;

export const pageCheck = (change: Partial<ITaskDefinitionView> = {}): ITaskDefinitionView => ({
  id: 'check-fact-on-page',
  revision: 1,
  title: 'Check a fact on a page I give you',
  category: 'Research',
  expectedResult: 'A yes, no or not-stated answer with the supporting passage.',
  inputs: [
    { name: 'page', label: 'Page address', kind: 'text', required: true },
    { name: 'question', label: 'What to check', kind: 'text', required: true },
  ],
  capabilities: ['web.read'],
  effectCeiling: 'read-only',
  completionEvidence: { kind: 'source-readback', description: 'The passage is read back.' },
  readiness: READY,
  startable: true,
  ...change,
});

/** An open offer for the page check, as the agent lists it. */
export const offer = (change: Partial<ITaskOfferView> = {}): ITaskOfferView => ({
  id: 'offer-1',
  definitionId: 'check-fact-on-page',
  definitionRevision: 1,
  definitionTitle: 'Check a fact on a page I give you',
  withdrawn: false,
  source: 'agent',
  reason: 'You asked whether shipping is free.',
  basis: 'The returns policy links to the shipping page.',
  contextRefs: [],
  createdAt: '2026-11-25T09:00:00.000Z',
  expiresAt: '2099-12-01T09:00:00.000Z',
  decision: 'open',
  prefilled: { page: PAGE, question: QUESTION },
  evidence: { kind: 'library', sourceItemId: 'returns-policy', observedAt: '2026-11-25T08:30:00Z' },
  readiness: READY,
  ...change,
});

export const LAUNCH_ID = 'launch-1';

export const ANSWER: ITaskStartAnswer = {
  launch: {
    id: LAUNCH_ID,
    definitionId: 'check-fact-on-page',
    definitionRevision: 1,
    status: 'launched',
    goalId: 'goal-1',
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
  },
  goalId: 'goal-1',
};

/** What the agent says of the launch right after it was started. */
export const STARTING: ITaskLaunchStatusView = {
  ...ANSWER.launch,
  progress: 'starting',
  reason: 'Your agent is getting this task going.',
  evidence: [],
};

type TStart = IPersonalApi['startTask'];

export interface IOffersWorld {
  readonly api: IPersonalApi;
  readonly taskOffers: Mock<IPersonalApi['taskOffers']>;
  readonly taskOffer: Mock<IPersonalApi['taskOffer']>;
  readonly decideTaskOffer: Mock<IPersonalApi['decideTaskOffer']>;
  readonly startTask: Mock<TStart>;
  /** The keys the page made for its requests, in order. */
  readonly keys: string[];
  readonly newKey: () => string;
  /** The offers as the agent keeps them. */
  readonly records: Map<string, ITaskOfferView>;
}

const withoutReadiness = (value: ITaskOfferView): ITaskOfferView => {
  const { readiness: _readiness, ...rest } = value;
  return rest;
};

export function offersWorld(
  options: {
    offers?: readonly ITaskOfferView[];
    definitions?: readonly ITaskDefinitionView[];
    launches?: readonly ITaskLaunchStatusView[];
    start?: TStart;
    /** Makes a read of the list fail, by the number of the read (1 is the first). */
    failRead?: (read: number) => Error | undefined;
  } = {},
): IOffersWorld {
  const records = new Map((options.offers ?? []).map((entry) => [entry.id, entry]));
  let reads = 0;
  const listing = (): ITaskOffersView => ({
    offers: [...records.values()]
      .filter((entry) => entry.decision === 'open' || entry.decision === 'accepted')
      .map((entry) => (entry.decision === 'open' ? entry : withoutReadiness(entry))),
    setAside: [...records.values()]
      .filter((entry) => entry.decision === 'dismissed' || entry.decision === 'snoozed')
      .map(withoutReadiness),
    issues: [],
  });
  const taskOffers = vi.fn<IPersonalApi['taskOffers']>(async () => {
    reads += 1;
    const failure = options.failRead?.(reads);
    if (failure !== undefined) throw failure;
    return listing();
  });
  const taskOffer = vi.fn<IPersonalApi['taskOffer']>(async (id) => {
    const found = records.get(id);
    if (found === undefined) throw new Error('There is no such offer.');
    return found;
  });
  const decideTaskOffer = vi.fn<IPersonalApi['decideTaskOffer']>(
    async (id: string, request: TTaskOfferDecisionRequest): Promise<ITaskOfferDecisionView> => {
      const found = records.get(id)!;
      const { snoozedUntil: _until, ...rest } = found;
      const next: ITaskOfferView =
        request.decision === 'snoozed'
          ? { ...rest, decision: 'snoozed', snoozedUntil: request.snoozedUntil }
          : { ...rest, decision: request.decision };
      records.set(id, request.decision === 'open' ? { ...next, readiness: READY } : next);
      return {
        id,
        decision: request.decision,
        ...(request.decision === 'snoozed' && { snoozedUntil: request.snoozedUntil }),
      };
    },
  );
  const startTask = vi.fn<TStart>(
    options.start ??
      (async (_definitionId, request) => {
        const found = request.offerId === undefined ? undefined : records.get(request.offerId);
        if (found !== undefined)
          records.set(found.id, { ...found, decision: 'accepted', launchId: LAUNCH_ID });
        return ANSWER;
      }),
  );
  const keys: string[] = [];
  const newKey = (): string => {
    keys.push(`start-key-${keys.length + 1}`);
    return keys.at(-1)!;
  };
  const api = {
    taskDefinitions: async () => options.definitions ?? [pageCheck()],
    taskOffers,
    taskOffer,
    decideTaskOffer,
    taskLaunches: async () => options.launches ?? [],
    taskLaunch: async () => STARTING,
    startTask,
  } as unknown as IPersonalApi;
  return { api, taskOffers, taskOffer, decideTaskOffer, startTask, keys, newKey, records };
}
