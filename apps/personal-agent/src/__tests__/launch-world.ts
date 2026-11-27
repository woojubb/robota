/**
 * A launch coordinator over real goal and launch stores, with the readiness the test says it is, and a
 * way to make goal creation or the recording of a launch fail the way a crash does.
 */
import { GoalBook, createMemoryGoalStore } from '@robota-sdk/agent-product/personal';
import { vi } from 'vitest';

import { localBrowserBindings } from '../task-catalog/binding-providers.js';
import { createTaskCatalog } from '../task-catalog/catalog.js';
import { createLaunchCoordinator } from '../task-catalog/launch/coordinator.js';
import { LAUNCH_RECIPES, canStart } from '../task-catalog/launch/recipes.js';
import { createMemoryLaunchStore } from '../task-catalog/launch/store.js';
import { createMemoryTaskCatalogStore } from '../task-catalog/store.js';

import type {
  IBrowserPort,
  IBrowserView,
  ICreateGoalInput,
  IGoal,
  IGoalRun,
  IGoalStore,
  TGoalRunOutcome,
} from '@robota-sdk/agent-product/personal';
import type { Mock } from 'vitest';
import type { ITaskCatalog } from '../task-catalog/catalog.js';
import type { IReadinessContext } from '../task-catalog/readiness.js';
import type { ILaunchCoordinator, ILaunchOffers } from '../task-catalog/launch/coordinator.js';
import type { IEvidenceRule } from '../task-catalog/launch/evidence-rules.js';
import type { ILaunchRecipe, TCapabilityTools } from '../task-catalog/launch/recipes.js';
import type { ILaunchStore } from '../task-catalog/launch/store.js';
import type {
  IEvidenceReceipt,
  ILaunchIntent,
  ILaunchOutcome,
  IPageRefusal,
} from '../task-catalog/launch/types.js';
import type { ITaskDefinition } from '../task-catalog/types.js';

export const PAGE = 'https://example.com/pricing';
export const QUESTION = 'Does the page say shipping is free?';
export const DEFINITION = 'check-fact-on-page';

/** A key of the shape the page makes; `n` tells two apart. */
export const keyOf = (n = 1): string => `key-${String(n).padStart(8, '0')}`;

export const request = (
  change: { key?: string; inputs?: unknown; definitionId?: string } = {},
): { definitionId: string; idempotencyKey: string; inputs: unknown } => ({
  definitionId: change.definitionId ?? DEFINITION,
  idempotencyKey: change.key ?? keyOf(),
  inputs: change.inputs ?? { page: PAGE, question: QUESTION },
});

/** A reserved intent; `n` tells two apart and orders them by their creation time. */
export const launchIntent = (n: number, change: Partial<ILaunchIntent> = {}): ILaunchIntent => {
  const at = new Date(Date.parse('2026-11-24T09:00:00Z') + n * 1000).toISOString();
  return {
    id: `launch-${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`,
    idempotencyKey: `key-${String(n).padStart(8, '0')}`,
    requestDigest: 'a'.repeat(64),
    definitionId: 'check-fact-on-page',
    definitionRevision: 1,
    definitionDigest: 'b'.repeat(64),
    inputs: { page: 'https://example.com/pricing', question: 'Is shipping free?' },
    bindings: [
      {
        capability: 'web.read',
        adapter: 'local-browser',
        effect: 'read-only',
        argumentBoundary: 'https pages the person names, read in the agent’s own browser',
      },
    ],
    origin: { kind: 'manual' },
    status: 'reserved',
    createdAt: at,
    updatedAt: at,
    ...change,
  };
};

export type TBrowser = 'ready' | 'unavailable' | 'needs-setup';

/** What the host knows about the agent's own browser, in each state a card can be in. */
export function browserContext(state: TBrowser): IReadinessContext {
  if (state === 'needs-setup')
    return {
      bindings: [],
      blockers: [
        {
          capability: 'web.read',
          effect: 'read-only',
          outcome: 'needs-setup',
          step: { type: 'reconnect', connectorId: 'connector-x', connectorTitle: 'Work' },
        },
      ],
      accounts: [],
    };
  return localBrowserBindings({ browserAvailable: () => state === 'ready' });
}

export interface IWorldOptions {
  readonly goalStore?: IGoalStore;
  readonly launchStore?: ILaunchStore;
  readonly browser?: { current: TBrowser };
  /** What the host knows instead of the browser's state: a test of connector setup supplies its own. */
  readonly readiness?: () => Promise<IReadinessContext>;
  readonly builtIn?: readonly ITaskDefinition[];
  readonly recipes?: readonly ILaunchRecipe[];
  readonly rules?: readonly IEvidenceRule[];
  /** The browser the coordinator wraps for a launched run; none means no run records anything. */
  readonly browserPort?: IBrowserPort;
  /** The offers a start may come from; none means a start names no offer. */
  readonly offers?: ILaunchOffers;
  readonly pageHosts?: readonly string[];
  readonly clock?: { now: Date };
  readonly resumeWithinMs?: number;
  readonly setupWithinMs?: number;
  readonly capabilityTools?: TCapabilityTools;
  /** A process that dies after goal creation or before it: nothing more is kept once these are on. */
  readonly dying?: { goal?: 'before' | 'after'; recording?: boolean };
  /** A goal store that will not remove a goal, as one that has just started would not. */
  readonly refuseRemove?: boolean;
}

export interface IWorld {
  readonly goals: GoalBook;
  readonly catalog: ITaskCatalog;
  readonly launches: ILaunchCoordinator;
  /** The launch store as the coordinator reads it, without the failures a test injects. */
  readonly store: ILaunchStore;
  readonly browser: { current: TBrowser };
  readonly clock: { now: Date };
  readonly behavior: { goal?: 'before' | 'after'; recording: boolean };
  readonly create: Mock<(input: ICreateGoalInput) => Promise<IGoal>>;
  readonly onGoalReady: Mock<() => void>;
}

export function startWorld(options: IWorldOptions = {}): IWorld {
  const browser = options.browser ?? { current: 'ready' as TBrowser };
  const clock = options.clock ?? { now: new Date('2026-11-24T10:00:00Z') };
  const goals = new GoalBook({
    store: options.goalStore ?? createMemoryGoalStore(),
    now: () => clock.now,
  });
  const launchStore = options.launchStore ?? createMemoryLaunchStore({ now: () => clock.now });
  const catalog = createTaskCatalog({
    store: createMemoryTaskCatalogStore(),
    readiness: options.readiness ?? (async () => browserContext(browser.current)),
    startable: (definition) =>
      canStart(options.recipes ?? LAUNCH_RECIPES, definition, options.capabilityTools),
    ...(options.builtIn !== undefined && { builtIn: options.builtIn }),
  });
  const behavior: { goal?: 'before' | 'after'; recording: boolean } = {
    ...(options.dying?.goal !== undefined && { goal: options.dying.goal }),
    recording: options.dying?.recording === true,
  };
  const onGoalReady = vi.fn<() => void>();
  const create = vi.fn(async (input: ICreateGoalInput): Promise<IGoal> => {
    if (behavior.goal === 'before') throw new Error('goal store is down');
    const made = await goals.create(input);
    if (behavior.goal === 'after') throw new Error('goal store failed after writing');
    return made;
  });
  const store: ILaunchStore = {
    ...launchStore,
    advance: async (id, change) => {
      if (behavior.recording) throw new Error('the process died');
      return launchStore.advance(id, change);
    },
  };
  const launches: ILaunchCoordinator = createLaunchCoordinator({
    store,
    catalog,
    goals: {
      create,
      list: () => goals.list(),
      get: (id) => goals.get(id),
      remove: (id) =>
        options.refuseRemove === true
          ? Promise.reject(new Error('the goal is running'))
          : goals.remove(id),
      runs: (goalId, limit) => goals.runs(goalId, limit),
    },
    recipes: options.recipes ?? LAUNCH_RECIPES,
    ...(options.rules !== undefined && { rules: options.rules }),
    ...(options.browserPort !== undefined && { browser: options.browserPort }),
    ...(options.offers !== undefined && { offers: options.offers }),
    ...(options.pageHosts !== undefined && { pageHosts: options.pageHosts }),
    now: () => clock.now,
    onGoalReady,
    ...(options.resumeWithinMs !== undefined && { resumeWithinMs: options.resumeWithinMs }),
    ...(options.setupWithinMs !== undefined && { setupWithinMs: options.setupWithinMs }),
    ...(options.capabilityTools !== undefined && { capabilityTools: options.capabilityTools }),
  });
  return {
    goals,
    catalog,
    launches,
    store: launchStore,
    browser,
    clock,
    behavior,
    create,
    onGoalReady,
  };
}

export type TWorld = IWorld;

/** A run's stand-in for the run the goal runner would have made: only its id matters to the host. */
export const runOf = (goal: IGoal, id = 'run-1'): IGoalRun => ({
  id,
  goalId: goal.id,
  startedAt: '2026-11-24T10:00:01.000Z',
  actions: [],
});

/**
 * What the host's browser recorded for a page read, as the host makes it; `requested` is left out
 * unless the test gives one, as it is for a read of the current page.
 */
export const receipt = (change: Partial<IEvidenceReceipt> = {}): IEvidenceReceipt => ({
  kind: 'page-read',
  tool: 'open',
  requested: PAGE,
  address: PAGE,
  chars: 120,
  digest: 'c'.repeat(64),
  excerpt: 'Free shipping on orders over 20 dollars',
  at: '2026-11-24T10:00:05.000Z',
  ...change,
});

/**
 * What the host's browser records when it keeps a run from a page, as the host makes it: here a run
 * that asked to open an address nobody named.
 */
export const refusal = (change: Partial<IPageRefusal> = {}): IPageRefusal => ({
  kind: 'page-refused',
  tool: 'open',
  reason: 'unnamed',
  requested: 'https://elsewhere.example/pricing',
  at: '2026-11-24T10:00:05.000Z',
  ...change,
});

/** An outcome as the host decides one, for a store test that keeps it. */
export const outcomeOf = (change: Partial<ILaunchOutcome> = {}): ILaunchOutcome => ({
  state: 'verified',
  reason: 'Your agent’s own browser opened and read the page you named during this run.',
  evidence: [receipt()],
  decidedAt: '2026-11-24T10:00:10.000Z',
  runId: 'run-1',
  report: 'Yes. Free shipping on orders over 20 dollars.',
  ...change,
});

/**
 * One whole run of a launched goal as a host sees it: the run starts, the host's browser records the
 * given reads for it, and the run ends as told, so the goal is over and its launch can be decided.
 */
export async function runLaunchedGoal(
  world: IWorld,
  goalId: string,
  ending: {
    readonly outcome: TGoalRunOutcome;
    readonly report: string;
    readonly reads?: readonly IEvidenceReceipt[];
  },
): Promise<IGoalRun> {
  const goal = (await world.goals.get(goalId))!;
  const run = await world.goals.startRun(goalId);
  for (const read of ending.reads ?? [])
    await world.store.recordReceipt(goal.launch!.id, goalId, run.id, read);
  return world.goals.finishRun(run, ending.outcome, ending.report);
}

/**
 * A browser that serves the pages the test gives it and counts what it was asked, for a run to read
 * through; an address it has no page for is refused as the agent's own browser refuses one.
 */
export function stubBrowser(pages: Readonly<Record<string, IBrowserView>>) {
  let current: IBrowserView | undefined;
  const calls: string[] = [];
  const port: IBrowserPort = {
    open: async (url) => {
      calls.push(`open ${url}`);
      const found = pages[url];
      if (found === undefined) throw new Error('refused');
      current = found;
      return found;
    },
    view: async () => {
      calls.push('view');
      if (current === undefined) throw new Error('nothing is open');
      return current;
    },
    click: async (mark) => {
      calls.push(`click ${mark}`);
      return { view: current! };
    },
    type: async (mark) => {
      calls.push(`type ${mark}`);
      return { view: current! };
    },
    submitHeld: async (id) => {
      calls.push(`submit ${id}`);
      return { view: current! };
    },
    close: async () => {
      calls.push('close');
    },
  };
  return { port, calls };
}

/** What `siteBrowser` shows after opening an address: the page's text, and where it ended up if that is another address. */
export interface ISitePage {
  readonly text: string;
  readonly landsOn?: string;
}

/**
 * A browser over a few sites that counts what it was asked. An address it has no page for still
 * answers, with a page of its own, so a test tells a fence that stopped a request from a browser that
 * had nothing to give. A page may land on another address, as a redirect does, and `moveTo` is a page
 * that goes elsewhere by itself, or that another chat took the browser to.
 */
export function siteBrowser(
  sites: Readonly<Record<string, ISitePage>> = {},
  options: { readonly leftOn?: IBrowserView } = {},
) {
  let current: IBrowserView | undefined = options.leftOn;
  const calls: string[] = [];
  const port: IBrowserPort = {
    open: async (url) => {
      calls.push(`open ${url}`);
      let href = url;
      let bare = url;
      try {
        const parsed = new URL(url);
        href = parsed.href;
        parsed.hash = '';
        bare = parsed.href;
      } catch {
        // allow-fallback: a stand-in browser answers any text, so a test sees what a fence let through.
      }
      const page = sites[bare] ?? { text: 'A page nobody named.' };
      current = { url: page.landsOn ?? href, title: 'Page', text: page.text, marks: [] };
      return current;
    },
    view: async () => {
      calls.push('view');
      if (current === undefined) throw new Error('nothing is open');
      return current;
    },
    click: async (mark) => {
      calls.push(`click ${mark}`);
      return { view: current! };
    },
    type: async (mark) => {
      calls.push(`type ${mark}`);
      return { view: current! };
    },
    submitHeld: async (id) => {
      calls.push(`submit ${id}`);
      return { view: current! };
    },
    close: async () => {
      calls.push('close');
    },
  };
  return {
    port,
    calls,
    moveTo: (view: IBrowserView): void => {
      current = view;
    },
  };
}
