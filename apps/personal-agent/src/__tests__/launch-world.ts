/**
 * A launch coordinator over real goal and launch stores, with the readiness the test says it is, and a
 * way to make goal creation or the recording of a launch fail the way a crash does.
 */
import { GoalBook, createMemoryGoalStore } from '@robota-sdk/agent-product/personal';
import { vi } from 'vitest';

import { localBrowserBindings } from '../task-catalog/binding-providers.js';
import { createTaskCatalog } from '../task-catalog/catalog.js';
import { createLaunchCoordinator } from '../task-catalog/launch/coordinator.js';
import { LAUNCH_RECIPES } from '../task-catalog/launch/recipes.js';
import { createMemoryLaunchStore } from '../task-catalog/launch/store.js';
import { createMemoryTaskCatalogStore } from '../task-catalog/store.js';

import type { ICreateGoalInput, IGoal, IGoalStore } from '@robota-sdk/agent-product/personal';
import type { Mock } from 'vitest';
import type { ITaskCatalog } from '../task-catalog/catalog.js';
import type { IReadinessContext } from '../task-catalog/readiness.js';
import type { ILaunchCoordinator } from '../task-catalog/launch/coordinator.js';
import type { ILaunchRecipe } from '../task-catalog/launch/recipes.js';
import type { ILaunchStore } from '../task-catalog/launch/store.js';
import type { ILaunchIntent } from '../task-catalog/launch/types.js';
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
  readonly builtIn?: readonly ITaskDefinition[];
  readonly recipes?: readonly ILaunchRecipe[];
  readonly pageHosts?: readonly string[];
  readonly clock?: { now: Date };
  readonly resumeWithinMs?: number;
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
    readiness: async () => browserContext(browser.current),
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
    },
    recipes: options.recipes ?? LAUNCH_RECIPES,
    ...(options.pageHosts !== undefined && { pageHosts: options.pageHosts }),
    now: () => clock.now,
    onGoalReady,
    ...(options.resumeWithinMs !== undefined && { resumeWithinMs: options.resumeWithinMs }),
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
