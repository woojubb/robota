/**
 * The personal agent's own API for its web UI: the library (knowledge wiki), search and settings.
 * The shared loopback GUI server reaches it only for the browser holding the access cookie, and only
 * with the write header for anything that changes state, so this module decides what, not who.
 *
 * What a person types here is the person's own word: a fact added or corrected from the page is
 * filed with origin `owner`. The provider key never passes through: settings name the environment
 * variable that holds it.
 */
import { findProviderDefinition, formatSupportedProviderTypes } from '@robota-sdk/agent-core';
import {
  CaseRefusedError,
  ConnectorRefusedError,
  DeliveryRefusedError,
  GoalRefusedError,
  IdeaRefusedError,
  SpaceRefusedError,
  PAGE_KINDS,
  SensitiveContentRefusedError,
} from '@robota-sdk/agent-product/personal';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider/builtin';

import { LayoutRefusedError } from './layout.js';
import { SideChatRefusedError } from './side-chats.js';
import { loadConfig, saveConfig } from './config.js';
import { createProviderFromProfile } from './provider.js';

import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type {
  BrowserOutbox,
  CaseBook,
  GoalBook,
  ICase,
  ISpace,
  IWikiPage,
  IdeaBook,
  KnowledgeWiki,
  NotificationAddress,
  QuestionDelivery,
  SpaceBook,
  TPageKind,
} from '@robota-sdk/agent-product/personal';
import type { IWatchedBrowser } from './browser/watched-browser.js';
import type { ILayoutBook } from './layout.js';
import type { ISideChatBook } from './side-chats.js';
import type { IGoalRunner } from './goal-runner.js';
import type { IProviderProfile } from './config.js';
import type { ICaseConnectorBindings } from './case-connector-binding.js';
import type { TConnectorsApi } from './connectors/connectors-api.js';
import type { TPushApi } from './push/push-api.js';
import type { TTaskCatalogApi } from './task-catalog/api.js';
import type { ICaseActionSnapshot } from './case-action.js';

export interface IPersonalApiOptions {
  readonly wiki: KnowledgeWiki;
  readonly goals: GoalBook;
  readonly cases: CaseBook;
  readonly caseBindings: ICaseConnectorBindings;
  /** The person's delivery limits: only their own request, through the routes here, reads or changes them. */
  readonly delivery: QuestionDelivery;
  /** The person's notification address: the page sets, clears and tests it, and never reads it back. */
  readonly notificationAddress: NotificationAddress;
  /** What the open page fetches to show the person; fetching it is what shows a page is open. */
  readonly notifications: BrowserOutbox;
  /** The browsers the person asked to be notified in while the page is closed: only a count is ever returned. */
  readonly push: TPushApi;
  /**
   * Called with a case once the person's answer is recorded on it. It must not wait for work: an
   * answer is already recorded when this runs, and an error from it never undoes or fails the answer.
   */
  readonly onCaseAnswered: (answered: ICase, snapshot?: ICaseActionSnapshot) => void;
  /** Capture existing authority before accepting the answer; an unavailable snapshot means read-only. */
  readonly captureCaseAction?: (
    caseId: string,
    feedItemId: string,
  ) => Promise<ICaseActionSnapshot | undefined>;
  readonly recoverCaseAnswer?: (feedItemId: string) => Promise<ICase | undefined>;
  readonly ideas: IdeaBook;
  readonly spaces: SpaceBook;
  readonly sideChats: ISideChatBook;
  readonly layout: ILayoutBook;
  /** The agent's browser as a watching person sees it. */
  readonly browser: IWatchedBrowser;
  /** End the agent's work in progress outside the chat (goal runs, messenger turns): Stop uses it. */
  readonly interruptWork: () => void;
  /** The goal runner, once the agent is running; approvals and "run now" need it. */
  readonly runner: () => IGoalRunner | undefined;
  readonly stateDir: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Whether the agent has a browser on this machine. */
  readonly browserAvailable: () => boolean;
  /** The connectors' routes: connect, disconnect, what each may do. */
  readonly connectors: TConnectorsApi;
  /** The task catalog's routes: the definitions the person can browse and the offers made to them. */
  readonly taskCatalog: TTaskCatalogApi;
}

export type TPersonalApi = (request: ILoopbackGuiApiRequest) => Promise<ILoopbackGuiApiResponse>;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

class BadRequest extends Error {}

const ok = (body: unknown): ILoopbackGuiApiResponse => ({ status: 200, body });
const fail = (status: number, error: string): ILoopbackGuiApiResponse => ({
  status,
  body: { error },
});

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new BadRequest('expected a JSON object');
  return body as Record<string, unknown>;
}

function text(body: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = body[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || value.trim() === '')
    throw new BadRequest(`${key} must be a non-empty string`);
  return value;
}

/** A text field that may be left empty; when it is sent, it has to be a string. */
function optionalText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new BadRequest(`${key} must be a string`);
  return value;
}

function summary(page: IWikiPage) {
  return {
    id: page.id,
    title: page.title,
    kind: page.kind,
    currentClaims: page.claims.filter((claim) => claim.validTo === undefined).length,
    updatedAt: page.updatedAt,
  };
}

export function providerTypes(): string[] {
  return createDefaultProviderDefinitions().map((definition) => definition.type);
}

export function createPersonalApi(options: IPersonalApiOptions): TPersonalApi {
  const { wiki, goals, cases, delivery, ideas, spaces, sideChats, layout, browser } = options;
  const { notificationAddress, notifications } = options;
  /** A space as the page shows it: its pinned pages that still exist, and the opening they make. */
  const spaceView = async (space: ISpace) => {
    const pinned = (await Promise.all(space.pages.map((pageId) => wiki.read(pageId))))
      .filter((page): page is IWikiPage => page !== undefined)
      .map((page) => ({ id: page.id, title: page.title }));
    return { ...space, pinned, opening: spaces.opening(space, pinned) };
  };

  const routes = async (request: ILoopbackGuiApiRequest): Promise<ILoopbackGuiApiResponse> => {
    const { method, segments } = request;
    const [area, collection, id, child] = segments;

    if (area === 'wiki' && collection === 'pages' && id === undefined) {
      if (method === 'GET') return ok({ pages: (await wiki.list()).map(summary) });
      if (method === 'POST') {
        const body = record(request.body);
        const kind = text(body, 'kind')!;
        if (!PAGE_KINDS.includes(kind as TPageKind))
          throw new BadRequest(`kind must be one of ${PAGE_KINDS.join(', ')}`);
        const filed = await wiki.remember({
          pageTitle: text(body, 'title')!,
          kind: kind as TPageKind,
          claim: text(body, 'text')!,
          source: { origin: 'owner' },
        });
        return ok({ pageId: filed.pageId });
      }
    }
    if (area === 'wiki' && collection === 'pages' && id !== undefined) {
      const page = await wiki.read(id);
      if (page === undefined) return fail(404, 'no such page');
      if (child === undefined && method === 'GET') return ok({ page });
      if (child === 'claims' && method === 'POST') {
        const body = record(request.body);
        const supersedes = text(body, 'supersedes', true);
        const filed = await wiki.remember({
          pageTitle: page.title,
          claim: text(body, 'text')!,
          source: { origin: 'owner' },
          ...(supersedes !== undefined && { supersedes }),
        });
        return ok({ claimId: filed.claimId });
      }
    }
    if (area === 'wiki' && collection === 'forget' && method === 'POST') {
      const body = record(request.body);
      const claimId = text(body, 'claimId', true);
      const pageId = text(body, 'pageId', true);
      if ((claimId === undefined) === (pageId === undefined))
        throw new BadRequest('give exactly one of claimId and pageId');
      const removed = await wiki.forget(claimId !== undefined ? { claimId } : { pageId: pageId! });
      return ok({ removed });
    }
    if (area === 'wiki' && collection === 'log' && method === 'GET')
      return ok({ entries: await wiki.log() });
    if (area === 'wiki' && collection === 'lint' && method === 'GET')
      return ok(await wiki.lint({ record: false }));

    if (area === 'goals' && collection === undefined) {
      if (method === 'GET') return ok({ goals: await goals.list() });
      if (method === 'POST') {
        const body = record(request.body);
        const everyMinutes = body['everyMinutes'];
        if (everyMinutes !== undefined && typeof everyMinutes !== 'number')
          throw new BadRequest('everyMinutes must be a number');
        const goal = await goals.create({
          title: text(body, 'title')!,
          instructions: text(body, 'instructions')!,
          ...(everyMinutes !== undefined && { everyMinutes }),
          readOnly: body['readOnly'] === true,
        });
        return ok({ goal });
      }
    }
    if (area === 'goals' && collection !== undefined) {
      const goal = await goals.get(collection);
      if (goal === undefined) return fail(404, 'no such goal');
      if (id === undefined && method === 'GET')
        return ok({ goal, runs: await goals.runs(goal.id) });
      if (method === 'POST' && id === 'pause') return ok({ goal: await goals.pause(goal.id) });
      if (method === 'POST' && id === 'resume') return ok({ goal: await goals.resume(goal.id) });
      if (method === 'POST' && id === 'stop') {
        await goals.remove(goal.id);
        return ok({ stopped: goal.id });
      }
      if (method === 'POST' && id === 'run') {
        const resumed = await goals.resume(goal.id);
        await options.runner()?.runDue();
        return ok({ goal: (await goals.get(goal.id)) ?? resumed });
      }
    }
    if (area === 'ideas' && collection === undefined) {
      if (method === 'GET') {
        const tag = request.query.get('tag') ?? undefined;
        return ok({
          ideas: await ideas.list({
            ...(tag !== undefined && tag !== '' && { tag }),
            includeArchived: request.query.get('archived') === '1',
          }),
        });
      }
      if (method === 'POST') {
        const body = record(request.body);
        const tags = body['tags'];
        if (
          tags !== undefined &&
          (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string'))
        ) {
          throw new BadRequest('tags must be a list of words');
        }
        return ok({
          idea: await ideas.add({
            text: text(body, 'text')!,
            origin: 'owner',
            ...(tags !== undefined && { tags: tags as string[] }),
          }),
        });
      }
    }
    if (area === 'ideas' && collection !== undefined && method === 'POST') {
      const idea = await ideas.get(collection);
      if (idea === undefined) return fail(404, 'no such idea');
      if (id === 'archive') return ok({ idea: await ideas.archive(idea.id) });
      if (id === 'remove') {
        await ideas.remove(idea.id);
        return ok({ removed: idea.id });
      }
      if (id === 'make-goal') {
        if (idea.status !== 'open')
          throw new BadRequest('This idea was already taken up or archived');
        // The person takes the idea up: it becomes a goal in their words, and the idea says so.
        const firstLine = idea.text.split(/[.!?\n]/u)[0]!.trim();
        const goal = await goals.create({
          title: firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine,
          instructions: idea.text,
        });
        return ok({ idea: await ideas.takeUp(idea.id, `goal:${goal.id}`), goal });
      }
    }
    if (area === 'spaces' && collection === undefined) {
      if (method === 'GET') {
        return ok({
          spaces: await Promise.all((await spaces.list()).map((space) => spaceView(space))),
        });
      }
      if (method === 'POST') {
        const body = record(request.body);
        const space = await spaces.create({
          name: text(body, 'name')!,
          instructions: optionalText(body, 'instructions'),
        });
        return ok({ space: await spaceView(space) });
      }
    }
    if (area === 'spaces' && collection !== undefined && method === 'POST') {
      if ((await spaces.get(collection)) === undefined) return fail(404, 'no such space');
      if (id === 'update') {
        const body = record(request.body);
        const space = await spaces.update(collection, {
          name: text(body, 'name')!,
          instructions: optionalText(body, 'instructions'),
        });
        return ok({ space: await spaceView(space) });
      }
      if (id === 'pin' || id === 'unpin') {
        const pageId = text(record(request.body), 'pageId')!;
        if (id === 'pin' && (await wiki.read(pageId)) === undefined)
          return fail(404, 'no such page');
        const space =
          id === 'pin'
            ? await spaces.pin(collection, pageId)
            : await spaces.unpin(collection, pageId);
        return ok({ space: await spaceView(space) });
      }
      if (id === 'remove') {
        await spaces.remove(collection);
        // A removed space leaves the person's tab order too.
        layout.saveTabs(layout.tabs().filter((tab) => tab !== `space:${collection}`));
        return ok({ removed: collection });
      }
    }
    if (area === 'feed' && collection === undefined && method === 'GET') {
      const items = (await goals.feed()).filter((item) => !item.dismissed);
      // An item of a goal a started task made carries that launch's id, read from the typed mark on the
      // goal and never from the item's words, so the page can link the report and its card to each other.
      const launches = new Map(
        (await goals.list()).flatMap((goal): [string, string][] =>
          goal.launch === undefined ? [] : [[goal.id, goal.launch.id]],
        ),
      );
      return ok({
        items: items.map((item) => {
          const launchId = item.goalId === undefined ? undefined : launches.get(item.goalId);
          return launchId === undefined ? item : { ...item, launchId };
        }),
      });
    }
    if (area === 'feed' && collection !== undefined && method === 'POST') {
      if (id === 'approve' || id === 'deny') {
        const runner = options.runner();
        if (runner === undefined) return fail(409, 'the agent is not running goals');
        try {
          return ok({ item: await runner.answer(collection, id === 'approve') });
        } catch (error) {
          throw new BadRequest(error instanceof Error ? error.message : String(error));
        }
      }
      if (id === 'dismiss') {
        await goals.dismiss(collection);
        return ok({ dismissed: collection });
      }
      if (id === 'answer') {
        const body = record(request.body);
        const { choice, reply } = body;
        if (choice !== undefined && typeof choice !== 'string')
          throw new BadRequest('choice must be a string');
        if (reply !== undefined && typeof reply !== 'string')
          throw new BadRequest('reply must be a string');
        const recoveredCase = await options.recoverCaseAnswer?.(collection);
        if (recoveredCase !== undefined) {
          const recovered = await goals.feedItem(collection);
          if (recovered === undefined) return fail(404, 'no such feed item');
          const saved = recovered.question?.answer;
          const same =
            (choice !== undefined && reply === undefined && saved?.choice === choice) ||
            (reply !== undefined && choice === undefined && saved?.reply === reply.trim());
          if (!same)
            return fail(
              409,
              'An earlier answer was saved. Review the recorded answer on this card.',
            );
          return ok({ item: recovered, case: recoveredCase });
        }
        const item = await goals.feedItem(collection);
        if (item === undefined) return fail(404, 'no such feed item');
        let snapshot: ICaseActionSnapshot | undefined;
        if (item.question?.state === 'open' && options.captureCaseAction !== undefined) {
          let cancelTimeout = (): void => undefined;
          try {
            snapshot = await Promise.race([
              options.captureCaseAction(item.question.caseId, collection),
              new Promise<undefined>((resolve) => {
                const timer = setTimeout(resolve, 1_000);
                cancelTimeout = () => clearTimeout(timer);
              }),
            ]);
          } catch {
            // An unavailable authority snapshot leaves this answer read-only.
          } finally {
            cancelTimeout();
          }
        }
        const answered = await cases.answer(
          collection,
          {
            ...(choice !== undefined && { choice }),
            ...(reply !== undefined && { reply }),
          },
          { context: snapshot },
        );
        try {
          options.onCaseAnswered(answered.case, snapshot);
        } catch {
          // allow-fallback: the answer is recorded; whatever follows it cannot fail the person's answer.
        }
        return ok({ item: answered.item, case: answered.case });
      }
    }
    if (area === 'cases' && collection === undefined && method === 'GET') {
      return ok({ cases: await cases.list() });
    }
    if (area === 'cases' && collection !== undefined && id === undefined && method === 'GET') {
      const found = await cases.get(collection);
      return found === undefined ? fail(404, 'no such case') : ok({ case: found });
    }
    if (area === 'cases' && collection !== undefined && id === 'connector') {
      if (method === 'GET') {
        const binding = await options.caseBindings.get(collection);
        return binding === undefined ? fail(404, 'no such case') : ok({ binding });
      }
      if (method === 'POST') {
        const body = record(request.body);
        const revision = text(body, 'revision')!;
        const connector = body['connectorId'];
        const fence = body['fence'];
        if (fence === true && connector !== undefined) throw new BadRequest('choose one change');
        if (fence !== undefined && fence !== true) throw new BadRequest('fence must be true');
        if (fence !== true && connector !== null && typeof connector !== 'string') {
          throw new BadRequest('connectorId must be a connector id or null');
        }
        const binding =
          fence === true
            ? await options.caseBindings.fence(collection, revision)
            : await options.caseBindings.set(collection, connector as string | null, revision);
        return binding === undefined ? fail(404, 'no such case') : ok({ binding });
      }
    }

    if (area === 'delivery' && collection === undefined) {
      if (method === 'GET') return ok(await delivery.status());
      if (method === 'PUT') {
        await delivery.updateSettings(request.body);
        return ok(await delivery.status());
      }
    }
    // The notification address may carry a token: every answer here is its host and format, never itself.
    if (area === 'delivery' && collection === 'webhook' && id === undefined) {
      if (method === 'GET') return ok(await notificationAddress.view());
      if (method === 'PUT') return ok(await notificationAddress.set(request.body));
      if (method === 'DELETE') return ok(await notificationAddress.clear());
    }
    if (area === 'delivery' && collection === 'webhook' && id === 'test' && method === 'POST') {
      await notificationAddress.test();
      return ok({ ok: true });
    }
    if (area === 'push') {
      const answered = await options.push(request);
      if (answered !== undefined) return answered;
    }
    if (area === 'notifications' && collection === undefined && method === 'GET') {
      const after = request.query.get('after');
      if (after !== null && !/^\d{1,15}$/u.test(after))
        throw new BadRequest('after must be a whole number');
      return ok(notifications.poll(after === null ? undefined : Number(after)));
    }

    if (area === 'browser') {
      if (collection === undefined && method === 'GET') {
        return ok({ available: options.browserAvailable(), ...browser.watch() });
      }
      if (collection === 'screenshot' && method === 'GET') {
        const snapshot = await browser.snapshot();
        return ok(
          snapshot === undefined
            ? { screenshot: null }
            : {
                screenshot: {
                  url: snapshot.url,
                  title: snapshot.title,
                  png: `data:image/png;base64,${Buffer.from(snapshot.png).toString('base64')}`,
                },
              },
        );
      }
      if (collection === 'stop' && method === 'POST') {
        // Whatever is driving the browser stops first, so it cannot open the pages again.
        options.interruptWork();
        await browser.stop();
        return ok({ stopped: true });
      }
    }
    if (area === 'connectors') {
      const answered = await options.connectors(request);
      if (answered !== undefined) return answered;
    }
    if (area === 'tasks') {
      const answered = await options.taskCatalog(request);
      if (answered !== undefined) return answered;
    }
    if (area === 'layout' && collection === undefined) {
      if (method === 'GET') return ok({ tabs: layout.tabs() });
      if (method === 'POST') {
        const tabs = record(request.body)['tabs'];
        if (!Array.isArray(tabs)) throw new BadRequest('tabs must be a list');
        return ok({ tabs: layout.saveTabs(tabs) });
      }
    }
    if (area === 'side-chats' && collection === undefined) {
      if (method === 'GET') return ok({ sideChats: sideChats.list() });
      if (method === 'POST') {
        const body = record(request.body);
        const parentId = body.parentId === undefined ? undefined : text(body, 'parentId')!;
        const chat = sideChats.add({
          id: text(body, 'id')!,
          ...(parentId !== undefined && { parentId }),
          title: optionalText(body, 'title'),
        });
        return ok({ sideChat: chat });
      }
    }
    if (area === 'side-chats' && collection !== undefined && id === 'remove' && method === 'POST') {
      return sideChats.remove(collection)
        ? ok({ removed: collection })
        : fail(404, 'no such side chat');
    }
    if (area === 'search' && method === 'GET') {
      const query = (request.query.get('q') ?? '').trim();
      if (query === '') return ok({ results: [] });
      const words = query.toLowerCase().split(/\s+/u);
      const hits = await wiki.search(query, 20);
      return ok({
        results: hits.map((hit) => ({
          page: summary(hit.page),
          matches: hit.page.claims
            .filter(
              (claim) =>
                claim.validTo === undefined &&
                words.some((word) => claim.text.toLowerCase().includes(word)),
            )
            .map((claim) => claim.text),
        })),
      });
    }

    if (area === 'settings' && collection === undefined && method === 'GET') {
      const { provider } = loadConfig(options.stateDir);
      return ok({
        ...(provider !== undefined && { provider }),
        providerTypes: providerTypes(),
        stateDir: options.stateDir,
        browser: { available: options.browserAvailable() },
      });
    }
    if (area === 'settings' && collection === 'provider' && method === 'PUT') {
      const body = record(request.body);
      const type = text(body, 'type')!;
      const definitions = createDefaultProviderDefinitions();
      if (findProviderDefinition(definitions, type) === undefined) {
        throw new BadRequest(
          `unknown provider type; supported: ${formatSupportedProviderTypes(definitions)}`,
        );
      }
      const baseURL = text(body, 'baseURL', true);
      const apiKeyEnv = text(body, 'apiKeyEnv', true);
      if (baseURL !== undefined && !URL.canParse(baseURL))
        throw new BadRequest('baseURL must be a URL');
      if (apiKeyEnv !== undefined && !ENV_NAME.test(apiKeyEnv))
        throw new BadRequest('apiKeyEnv must be an environment variable name');
      const provider: IProviderProfile = {
        type,
        model: text(body, 'model')!,
        ...(baseURL !== undefined && { baseURL }),
        ...(apiKeyEnv !== undefined && { apiKeyEnv }),
      };
      try {
        // Built once so a profile that cannot work is refused now, not at the next start.
        createProviderFromProfile(provider, options.environment);
      } catch (error) {
        throw new BadRequest(error instanceof Error ? error.message : String(error));
      }
      saveConfig(options.stateDir, { ...loadConfig(options.stateDir), provider });
      return ok({ saved: true, restartRequired: true });
    }
    return fail(404, 'not found');
  };

  return async (request) => {
    try {
      return await routes(request);
    } catch (error) {
      if (error instanceof BadRequest) return fail(400, error.message);
      if (error instanceof SensitiveContentRefusedError) return fail(422, error.message);
      if (error instanceof GoalRefusedError) return fail(400, error.message);
      if (error instanceof CaseRefusedError) return fail(400, error.message);
      if (error instanceof DeliveryRefusedError) return fail(400, error.message);
      if (error instanceof IdeaRefusedError) return fail(400, error.message);
      if (error instanceof SpaceRefusedError) return fail(400, error.message);
      if (error instanceof SideChatRefusedError) return fail(400, error.message);
      if (error instanceof LayoutRefusedError) return fail(400, error.message);
      if (error instanceof ConnectorRefusedError) return fail(400, error.message);
      if (error instanceof Error && /^No (current claim|wiki page)/u.test(error.message))
        return fail(400, error.message);
      throw error;
    }
  };
}
