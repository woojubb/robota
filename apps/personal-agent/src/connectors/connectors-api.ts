/**
 * The connectors' part of the personal API: what the Connectors tab lists and does. Nothing here
 * returns a token, a code or any text derived from one; a connection's state is a fixed word.
 */
import {
  ConnectorRefusedError,
  classifyTool,
  countPulled,
  defaultAttention,
  forgetPulled,
} from '@robota-sdk/agent-product/personal';

import { CaseActionMigrationError } from './case-action-scope.js';
import { CONSENT_CALLBACK_PATH } from './consent.js';

import type { IConnectorCatalog } from './catalog.js';
import type { ICaseActionScope } from './case-action-scope.js';

import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type {
  ConnectorBook,
  ConnectorRegistry,
  ConnectorSync,
  IConnector,
  IConnectorSyncStatus,
  IConnectorView,
  KnowledgeWiki,
  TConnectorAuth,
  TConnectorKind,
  TToolDecision,
} from '@robota-sdk/agent-product/personal';

export interface IConnectorsApiOptions {
  readonly registry: ConnectorRegistry;
  readonly book: ConnectorBook;
  /** The goals that keep connectors in sync. */
  readonly sync: ConnectorSync;
  /** The library, where what a sync keeps is counted and, on request, forgotten. */
  readonly wiki: KnowledgeWiki;
  /** The origins the person's browser reaches this agent at; a sign-in returns to one of them. */
  readonly origins: () => readonly string[];
  /** The services the add form can suggest. */
  readonly catalog: IConnectorCatalog;
  readonly caseActions: ICaseActionScope;
}

export type TConnectorsApi = (
  request: ILoopbackGuiApiRequest,
) => Promise<ILoopbackGuiApiResponse | undefined>;

const ok = (body: unknown): ILoopbackGuiApiResponse => ({ status: 200, body });

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ConnectorRefusedError('expected a JSON object');
  }
  return body as Record<string, unknown>;
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConnectorRefusedError(`${key} must be a non-empty string`);
  }
  return value;
}

function present(
  view: IConnectorView,
  caseScope: {
    readonly tools: readonly string[];
    readonly revision?: string;
    readonly error?: true;
    readonly transition?: true;
    readonly pending?: true;
  },
  sync?: IConnectorSyncStatus,
): Record<string, unknown> {
  const { connector, status, tools } = view;
  return {
    id: connector.id,
    title: connector.title,
    kind: connector.kind,
    protocol: connector.protocol,
    endpoint: connector.endpoint,
    ...(connector.auth !== undefined && { auth: connector.auth }),
    ...(connector.tokenHeader !== undefined && { tokenHeader: connector.tokenHeader }),
    ...(connector.oauth !== undefined && { oauth: connector.oauth }),
    // The person's own words about what to be asked, when they wrote some, and what applies without them.
    ...(connector.attention !== undefined && { attention: connector.attention }),
    defaultAttention: defaultAttention(connector.kind),
    caseActionTools: caseScope.tools,
    ...(caseScope.revision !== undefined && { caseActionRevision: caseScope.revision }),
    ...(caseScope.error === true && { caseActionScopeError: true }),
    ...(caseScope.transition === true && { caseActionTransition: true }),
    ...(caseScope.pending === true && { caseActionChangePending: true }),
    status,
    ...(sync !== undefined && { sync }),
    ...(tools !== undefined && {
      tools: tools.map((tool) => ({
        name: tool.name,
        ...(tool.description !== undefined && { description: tool.description }),
        access: tool.access,
        ...(tool.decision !== undefined && { decision: tool.decision }),
        ...(tool.hints !== undefined && { hints: tool.hints }),
      })),
    }),
  };
}

/** Connector identity and case settings without waiting for a service to answer. */
function presentPending(
  connector: IConnector,
  scope: {
    readonly tools: readonly string[];
    readonly revision?: string;
    readonly error?: true;
    readonly transition?: true;
    readonly pending?: true;
  },
): Record<string, unknown> {
  return {
    id: connector.id,
    title: connector.title,
    kind: connector.kind,
    endpoint: connector.endpoint,
    ...(connector.auth !== undefined && { auth: connector.auth }),
    ...(connector.tokenHeader !== undefined && { tokenHeader: connector.tokenHeader }),
    ...(connector.oauth !== undefined && { oauth: connector.oauth }),
    ...(connector.attention !== undefined && { attention: connector.attention }),
    defaultAttention: defaultAttention(connector.kind),
    caseActionTools: scope.tools,
    ...(scope.revision !== undefined && { caseActionRevision: scope.revision }),
    ...(scope.error === true && { caseActionScopeError: true }),
    ...(scope.transition === true && { caseActionTransition: true }),
    ...(scope.pending === true && { caseActionChangePending: true }),
    status: { state: 'checking' },
  };
}

const DECISIONS: readonly string[] = ['read', 'write', 'blocked'];
/** A client secret is one word of printable characters; its value is never repeated in an answer. */
const CLIENT_SECRET = /^[\x21-\x7e]{1,512}$/;

/** A token is one word of printable characters; its value is never repeated in an answer. */
const TOKEN = /^[\x21-\x7e]{1,4096}$/;

/** The token typed for this connection, or `undefined` when none was given. */
function tokenOf(body: Record<string, unknown>): string | undefined {
  const value = body['token'];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw new ConnectorRefusedError('The token must be one word of printable characters');
  }
  return value;
}

/** The secret typed for this sign-in, or `undefined` when none was given. */
function clientSecretOf(body: Record<string, unknown>): string | undefined {
  const value = body['clientSecret'];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !CLIENT_SECRET.test(value)) {
    throw new ConnectorRefusedError('The client secret must be one word of printable characters');
  }
  return value;
}

/** The sign-in options as words, or `undefined` when none were given. */
function authorizationParamsOf(body: Record<string, unknown>): Record<string, string> | undefined {
  const value = body['authorizationParams'];
  if (value === undefined) return undefined;
  const entries =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value)
      : undefined;
  if (entries === undefined || !entries.every(([, word]) => typeof word === 'string')) {
    throw new ConnectorRefusedError('authorizationParams must be an object of words');
  }
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as Record<string, string>);
}

/** Answers `connectors/...` requests, or `undefined` for a path that is not one. */
export function createConnectorsApi(options: IConnectorsApiOptions): TConnectorsApi {
  const { registry, book, sync, wiki, catalog, caseActions } = options;
  let changes: Promise<void> = Promise.resolve();
  /** Connector records and case scopes share one cross-process mutation boundary. */
  const change = <T>(work: () => Promise<T>): Promise<T> => {
    const result = changes.then(() => caseActions.exclusive(work));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    changes = tail;
    return result;
  };
  const caseScope = async (
    id: string,
  ): Promise<{
    readonly tools: readonly string[];
    readonly revision?: string;
    readonly error?: true;
    readonly transition?: true;
    readonly pending?: true;
  }> => {
    try {
      return await change(async () => {
        // A stale page request must not recreate settings after the connector was removed.
        if ((await book.get(id)) === undefined) return { tools: [], error: true };
        try {
          await caseActions.initialize(id);
          return caseActions.snapshot(id);
        } catch (error) {
          if (!(error instanceof ConnectorRefusedError)) throw error;
          try {
            if (caseActions.transitioning(id)) return { tools: [], error: true, transition: true };
            const pending = caseActions.pendingSnapshot(id);
            if (pending !== undefined) return { ...pending, pending: true };
            return { tools: [], revision: caseActions.errorRevision(id), error: true };
          } catch (recoveryError) {
            if (!(recoveryError instanceof ConnectorRefusedError)) throw recoveryError;
            return { tools: [], error: true };
          }
        }
      });
    } catch (error) {
      if (!(error instanceof ConnectorRefusedError)) throw error;
      return { tools: [], error: true };
    }
  };
  /** A connector as the page shows it, with how its sync stands. */
  const show = async (id: string, refresh = false): Promise<Record<string, unknown>> =>
    present(await registry.view(id, { refresh }), await caseScope(id), await sync.status(id));
  /** A scope change need not wait for the connector's network discovery to finish. */
  const showScope = async (id: string): Promise<Record<string, unknown>> =>
    presentPending(await book.existing(id), await caseScope(id));
  /** Whether the person asked to forget what was pulled; a request with no body asks for nothing. */
  const wantsForgetting = (body: unknown): boolean =>
    body !== undefined && record(body)['forgetPulled'] === true;
  const connecting = new Map<string, Set<Promise<void>>>();
  const finishConnection = async (
    id: string,
    transition: ReturnType<ICaseActionScope['beginDisconnect']>,
    initial: Awaited<ReturnType<typeof registry.signIn>>,
  ): Promise<void> => {
    let completed = false;
    try {
      let status = initial;
      const deadline = Date.now() + 10 * 60_000;
      while (status.state === 'connecting') {
        if (Date.now() >= deadline) throw new ConnectorRefusedError('The sign-in was interrupted');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 250);
          timer.unref();
        });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          status = await Promise.race([
            registry.status(id),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new ConnectorRefusedError('The sign-in could not be confirmed')),
                75_000,
              );
              timeout.unref();
            }),
          ]);
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      }
      // Keep the transition visible until after the credential has settled and old scope is gone.
      await change(() => caseActions.reset(id));
      transition.complete();
      completed = true;
    } finally {
      if (completed) {
        transition.release();
        await change(() => caseActions.settleDisconnects(id)).catch(() => undefined);
      }
    }
  };
  const disconnect = async (
    id: string,
  ): Promise<{
    outcome: Awaited<ReturnType<typeof registry.disconnect>>;
    secured: Promise<boolean>;
  }> => {
    const transition = caseActions.beginDisconnect(id);
    let outcome: Awaited<ReturnType<typeof registry.disconnect>>;
    let released = true;
    try {
      outcome = await registry.disconnect(id);
      try {
        transition.complete();
      } catch {
        // An interrupted marker stays closed until this disconnect is completed again.
      }
    } finally {
      try {
        transition.release();
      } catch {
        released = false;
      }
    }
    const secured = (async () => {
      const pending = [...(connecting.get(id) ?? [])];
      if (pending.length > 0) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const ended = await Promise.race([
            Promise.all(pending).then(() => true),
            new Promise<false>((resolve) => {
              timeout = setTimeout(() => resolve(false), 2_000);
            }),
          ]);
          if (!ended) return false;
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      }
      return caseActions
        .exclusiveConnector(id, () =>
          change(async () => {
            await caseActions.settleDisconnects(id, true);
          }),
        )
        .then(
          () => released,
          () => false,
        );
    })();
    return { outcome, secured };
  };
  /**
   * Take the access away first, so nothing in progress can hold it up, then stop the sync (ending a
   * run that is still going) and, when asked, forget what the connector put in the library, which
   * only a stopped sync can no longer add to.
   */
  const leave = async (
    id: string,
    body: unknown,
    take: () => ReturnType<typeof disconnect>,
  ): Promise<ILoopbackGuiApiResponse> => {
    const forget = wantsForgetting(body);
    let result: Awaited<ReturnType<typeof disconnect>>;
    try {
      result = await take();
    } catch (error) {
      await sync.disable(id);
      if (forget) await forgetPulled(wiki, id);
      throw error;
    }
    const { outcome, secured } = result;
    await sync.disable(id);
    const forgotten = forget ? await forgetPulled(wiki, id) : undefined;
    if (!(await secured))
      return {
        status: 500,
        body: {
          error: 'The connector was disconnected, but its case settings could not be secured.',
          outcome,
          ...(forgotten !== undefined && { forgotten }),
        },
      };
    return ok({ outcome, ...(forgotten !== undefined && { forgotten }) });
  };
  const known = async (id: string): Promise<boolean> => (await book.get(id)) !== undefined;
  const notFound: ILoopbackGuiApiResponse = { status: 404, body: { error: 'no such connector' } };

  return async (request) => {
    const [area, id, action, tool] = request.segments;
    if (area !== 'connectors') return undefined;
    const { method } = request;
    const body =
      typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : undefined;
    const caseTool =
      action === 'case-actions' && tool === undefined && typeof body?.['tool'] === 'string'
        ? body['tool']
        : tool;
    if (
      method === 'POST' &&
      action === 'case-actions' &&
      ((body?.['reset'] === true &&
        (tool !== undefined || body['tool'] !== undefined || body['allowed'] !== undefined)) ||
        (tool !== undefined && body?.['tool'] !== undefined && body['tool'] !== tool))
    ) {
      throw new ConnectorRefusedError('Choose a tool or reset, not both');
    }
    // Capture before the first await: a later reset must invalidate even a request whose connector
    // lookup or service discovery has not finished yet.
    let capturedVersion:
      | { readonly ok: true; readonly value: ReturnType<ICaseActionScope['version']> }
      | { readonly ok: false; readonly error: unknown }
      | undefined;
    if (
      id !== undefined &&
      method === 'POST' &&
      action === 'case-actions' &&
      caseTool !== undefined &&
      body?.['allowed'] === true
    ) {
      try {
        capturedVersion = { ok: true, value: caseActions.version(id, caseTool) };
      } catch (error) {
        capturedVersion = { ok: false, error };
      }
    }

    if (id === undefined) {
      if (method === 'GET') {
        return ok({
          callbackPath: CONSENT_CALLBACK_PATH,
          connectors: await Promise.all(
            (await registry.list()).map(async (view) =>
              present(
                view,
                await caseScope(view.connector.id),
                await sync.status(view.connector.id),
              ),
            ),
          ),
        });
      }
      if (method === 'POST') {
        const body = record(request.body);
        const scopes = body['scopes'];
        if (
          scopes !== undefined &&
          (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string'))
        ) {
          throw new ConnectorRefusedError('scopes must be a list of words');
        }
        const clientId = body['clientId'];
        if (clientId !== undefined && typeof clientId !== 'string') {
          throw new ConnectorRefusedError('clientId must be a string');
        }
        const authorizationParams = authorizationParamsOf(body);
        const auth = body['auth'];
        if (auth !== undefined && typeof auth !== 'string') {
          throw new ConnectorRefusedError('auth must be oauth, token or none');
        }
        const tokenHeader = body['tokenHeader'];
        if (tokenHeader !== undefined && typeof tokenHeader !== 'string') {
          throw new ConnectorRefusedError('tokenHeader must be a header name');
        }
        const connector = await change(() =>
          book.create({
            title: text(body, 'title'),
            kind: text(body, 'kind') as TConnectorKind,
            protocol: 'mcp',
            endpoint: text(body, 'endpoint'),
            ...(auth !== undefined && { auth: auth as TConnectorAuth }),
            ...(tokenHeader !== undefined && { tokenHeader }),
            ...((clientId !== undefined && clientId !== '') ||
            (scopes?.length ?? 0) > 0 ||
            authorizationParams !== undefined
              ? {
                  oauth: {
                    ...(clientId !== undefined && clientId !== '' && { clientId }),
                    ...(scopes !== undefined &&
                      scopes.length > 0 && { scopes: scopes as string[] }),
                    ...(authorizationParams !== undefined && { authorizationParams }),
                  },
                }
              : {}),
          }),
        );
        return ok({ connector: await show(connector.id) });
      }
      return undefined;
    }

    // The services the add form can suggest: values to fill in, not connectors.
    if (id === 'catalog' && action === undefined) {
      if (method !== 'GET') return undefined;
      const answer = await catalog.search(request.query.get('query') ?? '');
      return ok({ entries: answer.entries, registry: answer.registry });
    }

    if (id === 'case-actions' && action === 'summary' && tool === undefined && method === 'GET') {
      return ok({
        callbackPath: CONSENT_CALLBACK_PATH,
        connectors: await Promise.all(
          (await book.list()).map((connector) => showScope(connector.id)),
        ),
      });
    }
    if (id === 'case-actions' && action === 'fence' && tool === undefined && method === 'POST') {
      const result = await change(async () => {
        const completed: string[] = [];
        const connectors: Record<string, unknown>[] = [];
        for (const connector of await book.list()) {
          let scope: {
            readonly tools: readonly string[];
            readonly revision?: string;
            readonly error?: true;
            readonly transition?: true;
            readonly pending?: true;
          };
          try {
            await caseActions.initialize(connector.id);
            await caseActions.fence(connector.id);
            scope = caseActions.snapshot(connector.id);
            completed.push(connector.id);
          } catch (error) {
            if (!(error instanceof ConnectorRefusedError)) throw error;
            try {
              if (caseActions.transitioning(connector.id)) {
                scope = { tools: [], error: true, transition: true };
              } else {
                const pending = caseActions.pendingSnapshot(connector.id);
                scope =
                  pending !== undefined
                    ? { ...pending, pending: true }
                    : { tools: [], revision: caseActions.errorRevision(connector.id), error: true };
              }
            } catch (recoveryError) {
              if (!(recoveryError instanceof ConnectorRefusedError)) throw recoveryError;
              scope = { tools: [], error: true };
            }
          }
          connectors.push(presentPending(connector, scope));
        }
        return { fenced: completed, connectors, callbackPath: CONSENT_CALLBACK_PATH };
      });
      return ok(result);
    }

    if (!(await known(id))) return notFound;
    if (action === 'case-actions' && tool === undefined && method === 'GET') {
      return ok({ connector: await showScope(id) });
    }
    if (action === undefined && method === 'GET') {
      return ok({ connector: await show(id, request.query.get('refresh') === '1') });
    }
    if (action === 'pulled' && method === 'GET') return ok({ count: await countPulled(wiki, id) });
    // What the person wants to be asked about: their words replace the default, and empty text brings it back.
    if (action === 'attention' && method === 'PUT') {
      const words = record(request.body)['text'];
      if (typeof words !== 'string') throw new ConnectorRefusedError('text must be a string');
      const changed = await change(async () => {
        if (!(await known(id))) return false;
        await book.setAttention(id, words);
        return true;
      });
      return changed ? ok({ connector: await show(id) }) : notFound;
    }
    if (method !== 'POST') return undefined;
    if (action === 'connect') {
      const body = record(request.body);
      const clientSecret = clientSecretOf(body);
      const token = tokenOf(body);
      // Only an OAuth sign-in returns to this agent's page, so only it needs an origin that is ours.
      let normalized: string | undefined;
      if (body['origin'] !== undefined) {
        const origin = text(body, 'origin');
        normalized = URL.canParse(origin) ? new URL(origin).origin : undefined;
        if (normalized === undefined || !options.origins().includes(normalized)) {
          throw new ConnectorRefusedError('the agent is not reached at that origin');
        }
      }
      const current = await book.existing(id);
      const auth = current.auth ?? 'oauth';
      if (auth === 'none') throw new ConnectorRefusedError('This service needs no sign-in');
      if (auth === 'token' && token === undefined)
        throw new ConnectorRefusedError('Type the token for this service');
      if (auth === 'token' && clientSecret !== undefined)
        throw new ConnectorRefusedError('A client secret belongs to an OAuth sign-in');
      if (auth === 'oauth' && token !== undefined)
        throw new ConnectorRefusedError('This service signs in with OAuth, not a token');
      if (auth === 'oauth' && normalized === undefined)
        throw new ConnectorRefusedError('A sign-in needs the address of this page');
      if (clientSecret !== undefined && current.oauth?.clientId === undefined)
        throw new ConnectorRefusedError('A client secret goes with the client id you registered');
      // A reconnect can represent a different account. Keep case authority closed until the
      // credential has settled, and require the owner to choose case tools again afterward.
      const transition = caseActions.beginDisconnect(id);
      // On failure, leave the transition in place: sign-in may still be completing.
      await change(() => caseActions.reset(id));
      const status = await registry.signIn(id, {
        ...(normalized !== undefined && { origin: normalized }),
        ...(clientSecret !== undefined && { clientSecret }),
        ...(token !== undefined && { token }),
      });
      if (status.state === 'connecting') {
        const tasks = connecting.get(id) ?? new Set<Promise<void>>();
        connecting.set(id, tasks);
        const task = finishConnection(id, transition, status)
          .catch(() => undefined)
          .finally(() => {
            tasks.delete(task);
            if (tasks.size === 0) connecting.delete(id);
          });
        tasks.add(task);
      } else await finishConnection(id, transition, status);
      return ok({ status });
    }
    if (action === 'token') {
      const body = record(request.body);
      const token = tokenOf(body);
      if (token === undefined) throw new ConnectorRefusedError('Type the new token');
      const current = await book.existing(id);
      if ((current.auth ?? 'oauth') !== 'token')
        throw new ConnectorRefusedError('This service does not sign in with a token');
      // A token only stands in for one that is held: before that, the person connects.
      const held = await registry.status(id);
      if (held.state === 'not-connected' || held.state === 'failed') {
        return { status: 409, body: { error: 'Connect this service first' } };
      }
      // Case choices are closed only once the new token is certain to take effect: a refused
      // replacement leaves the person's choices alone, since the connection did not change.
      let transition: ReturnType<ICaseActionScope['beginDisconnect']> | undefined;
      const outcome = await registry.replaceToken(id, token, {
        beforeSwap: () => {
          transition = caseActions.beginDisconnect(id);
        },
      });
      if (!outcome.replaced) {
        return ok({ replaced: false, reason: outcome.reason, status: outcome.status });
      }
      // On failure, leave the transition in place, as for a sign-in: the credential did change.
      await finishConnection(id, transition!, outcome.status);
      return ok({ replaced: true, status: outcome.status });
    }
    if (action === 'disconnect') return leave(id, request.body, () => disconnect(id));
    if (action === 'remove') {
      // Taking the access away must not depend on acquiring the settings lock.
      const forget = wantsForgetting(request.body);
      let detached: Awaited<ReturnType<typeof disconnect>>;
      try {
        detached = await disconnect(id);
      } catch (error) {
        await sync.disable(id);
        if (forget) await forgetPulled(wiki, id);
        throw error;
      }
      const { outcome: disconnected, secured } = detached;
      try {
        await registry.remove(id);
      } catch {
        return {
          status: 500,
          body: {
            error: 'The connector was disconnected, but removal did not finish.',
            outcome: disconnected,
          },
        };
      }
      let cleanupFailed = !(await secured);
      try {
        await change(() => caseActions.clear(id));
      } catch {
        cleanupFailed = true;
      }
      let followupFailed = false;
      let forgotten: number | undefined;
      try {
        await sync.disable(id);
        if (forget) forgotten = await forgetPulled(wiki, id);
      } catch {
        followupFailed = true;
      }
      if (cleanupFailed || followupFailed) {
        const cleanupAdvice = cleanupFailed
          ? ' Its case-action settings could not be cleared. Stop every agent using this state directory and follow the case-request recovery instructions in the Personal Agent guide.'
          : '';
        const description = followupFailed
          ? 'The connector was removed, but its sync or library cleanup did not finish.'
          : 'The connector was removed.';
        return {
          status: 500,
          body: {
            error: `${description}${cleanupAdvice}`,
            connectorRemoved: true,
            outcome: disconnected,
            ...(cleanupFailed && { caseActionScopeCleanupFailed: true }),
          },
        };
      }
      return ok({ outcome: disconnected, ...(forgotten !== undefined && { forgotten }) });
    }
    if (action === 'sync') {
      const everyMinutes = record(request.body)['everyMinutes'];
      if (everyMinutes === null) {
        await sync.disable(id);
        return ok({ connector: await show(id) });
      }
      if (typeof everyMinutes !== 'number') {
        throw new ConnectorRefusedError('everyMinutes must be a number of minutes, or null');
      }
      const view = await registry.view(id);
      if (view.status.state !== 'connected') {
        throw new ConnectorRefusedError('Connect the service before keeping it in sync');
      }
      await sync.enable(view.connector, everyMinutes);
      return ok({ connector: await show(id) });
    }
    if (action === 'tools' && tool !== undefined) {
      const decision = record(request.body)['decision'];
      if (decision !== null && (typeof decision !== 'string' || !DECISIONS.includes(decision))) {
        throw new ConnectorRefusedError('decision must be read, write, blocked or null');
      }
      let changed: boolean;
      try {
        changed = await change(async () => {
          if (!(await known(id))) return false;
          const previous = await book.existing(id);
          if (decision !== 'write' || previous.decisions[tool] === 'blocked') {
            try {
              await caseActions.set(id, tool, false);
            } catch (error) {
              // A broken scope must never prevent the person from blocking the tool itself.
              if (decision !== 'blocked') throw error;
            }
          }
          await registry.decide(
            id,
            tool,
            decision === null ? undefined : (decision as TToolDecision),
          );
          return true;
        });
      } catch (error) {
        if (decision !== 'blocked' || !(error instanceof CaseActionMigrationError)) throw error;
        changed = await caseActions.exclusiveBlock(async () => {
          if (!(await known(id))) return false;
          await registry.decide(id, tool, 'blocked');
          return true;
        });
      }
      return changed ? ok({ connector: await show(id) }) : notFound;
    }
    if (action === 'case-actions' && caseTool === undefined && body?.['open'] === true) {
      if (Object.keys(body).length !== 1) {
        throw new ConnectorRefusedError('Choose one case action change');
      }
      const changed = await change(async () => {
        if (!(await known(id))) return false;
        await caseActions.initialize(id);
        await caseActions.fence(id);
        return true;
      });
      return changed ? ok({ connector: await showScope(id) }) : notFound;
    }
    if (
      action === 'case-actions' &&
      caseTool === undefined &&
      typeof body?.['fence'] === 'string'
    ) {
      if (
        body['reset'] !== undefined ||
        body['allowed'] !== undefined ||
        body['revision'] !== undefined
      ) {
        throw new ConnectorRefusedError('Choose one case action change');
      }
      const expected = body['fence'];
      const changed = await change(async () => {
        if (!(await known(id))) return false;
        await caseActions.fence(id, expected);
        return true;
      });
      return changed ? ok({ connector: await showScope(id) }) : notFound;
    }
    if (action === 'case-actions' && caseTool === undefined) {
      if (record(request.body)['reset'] !== true) {
        throw new ConnectorRefusedError('reset must be true');
      }
      const revision = body?.['revision'];
      if (typeof revision !== 'string') {
        throw new ConnectorRefusedError('Reload case action settings before resetting them');
      }
      const changed = await change(async () => {
        if (!(await known(id))) return false;
        await caseActions.reset(id, revision);
        return true;
      });
      return changed ? ok({ connector: await showScope(id) }) : notFound;
    }
    if (action === 'case-actions' && caseTool !== undefined) {
      const allowed = record(request.body)['allowed'];
      if (typeof allowed !== 'boolean')
        throw new ConnectorRefusedError('allowed must be true or false');
      const requested = body?.['revision'];
      if (typeof requested !== 'string') {
        throw new ConnectorRefusedError('Reload case action settings before changing a tool');
      }
      const captured = allowed ? capturedVersion : undefined;
      if (allowed && captured === undefined)
        throw new ConnectorRefusedError('Case action settings changed; try again');
      if (captured !== undefined && !captured.ok) throw captured.error;
      if (captured !== undefined && requested !== undefined && requested !== captured.value) {
        throw new ConnectorRefusedError('Case action settings changed; try again');
      }
      const version = requested;
      const view = allowed ? await registry.view(id) : undefined;
      const candidate = view?.tools?.find((item) => item.name === caseTool);
      if (allowed && (view?.status.state !== 'connected' || candidate === undefined)) {
        throw new ConnectorRefusedError('Choose a connected writable tool for case requests');
      }
      let staged: ReturnType<ICaseActionScope['stageAllow']> | undefined;
      const changed = await change(async () => {
        const current = await book.get(id);
        if (current === undefined) return false;
        if (allowed) {
          const latest = caseActions.version(id, caseTool);
          if (version !== latest) {
            throw new ConnectorRefusedError('Case action settings changed; try again');
          }
        }
        if (allowed && (candidate === undefined || classifyTool(current, candidate) !== 'write')) {
          throw new ConnectorRefusedError('Choose a connected writable tool for case requests');
        }
        if (allowed) staged = caseActions.stageAllow(id, caseTool, version);
        else await caseActions.set(id, caseTool, false, version);
        return true;
      });
      if (changed && staged !== undefined) {
        const revision = staged;
        try {
          await caseActions.exclusiveConnector(id, async () => {
            let connected = false;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              const state = await Promise.race([
                registry.status(id),
                new Promise<never>((_, reject) => {
                  timeout = setTimeout(
                    () => reject(new Error('Connection check timed out')),
                    10_000,
                  );
                  timeout.unref();
                }),
              ]);
              connected = state.state === 'connected';
            } catch {
              // An unconfirmed connection cannot grant authority.
            } finally {
              if (timeout !== undefined) clearTimeout(timeout);
            }
            await change(async () => {
              if (!(await known(id))) throw new ConnectorRefusedError('No such connector');
              caseActions.finishAllow(id, revision, connected);
            });
          });
        } catch (error) {
          await change(async () => {
            try {
              caseActions.finishAllow(id, revision, false);
            } catch {
              /* It was already settled or remains closed. */
            }
          }).catch(() => undefined);
          throw error;
        }
      }
      return changed ? ok({ connector: await showScope(id) }) : notFound;
    }
    return undefined;
  };
}
