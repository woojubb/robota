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

import { CONSENT_CALLBACK_PATH } from './consent.js';

import type { IConnectorCatalog } from './catalog.js';
import type { ICaseActionScope } from './case-action-scope.js';

import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type {
  ConnectorBook,
  ConnectorRegistry,
  ConnectorSync,
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
  caseScope: { readonly tools: readonly string[]; readonly error?: true },
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
    ...(caseScope.error === true && { caseActionScopeError: true }),
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
  ): Promise<{ readonly tools: readonly string[]; readonly error?: true }> => {
    try {
      return { tools: await caseActions.tools(id) };
    } catch (error) {
      if (!(error instanceof ConnectorRefusedError)) throw error;
      return { tools: [], error: true };
    }
  };
  /** A connector as the page shows it, with how its sync stands. */
  const show = async (id: string, refresh = false): Promise<Record<string, unknown>> =>
    present(await registry.view(id, { refresh }), await caseScope(id), await sync.status(id));
  /** Whether the person asked to forget what was pulled; a request with no body asks for nothing. */
  const wantsForgetting = (body: unknown): boolean =>
    body !== undefined && record(body)['forgetPulled'] === true;
  /**
   * Take the access away first, so nothing in progress can hold it up, then stop the sync (ending a
   * run that is still going) and, when asked, forget what the connector put in the library, which
   * only a stopped sync can no longer add to.
   */
  const leave = async (
    id: string,
    body: unknown,
    take: () => Promise<unknown>,
  ): Promise<ILoopbackGuiApiResponse> => {
    const forget = wantsForgetting(body);
    const outcome = await take();
    await sync.disable(id);
    return ok({ outcome, ...(forget && { forgotten: await forgetPulled(wiki, id) }) });
  };
  const known = async (id: string): Promise<boolean> => (await book.get(id)) !== undefined;
  const notFound: ILoopbackGuiApiResponse = { status: 404, body: { error: 'no such connector' } };

  return async (request) => {
    const [area, id, action, tool] = request.segments;
    if (area !== 'connectors') return undefined;
    const { method } = request;

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

    if (!(await known(id))) return notFound;
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
      return ok({
        status: await registry.signIn(id, {
          ...(normalized !== undefined && { origin: normalized }),
          ...(clientSecret !== undefined && { clientSecret }),
          ...(token !== undefined && { token }),
        }),
      });
    }
    if (action === 'disconnect') return leave(id, request.body, () => registry.disconnect(id));
    if (action === 'remove') {
      // Taking the access away must not depend on acquiring the settings lock.
      const forget = wantsForgetting(request.body);
      const disconnected = await registry.disconnect(id);
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
      let cleanupFailed = false;
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
          ? ` Restore write access to the agent state directory and remove case-action-scope/${id}.`
          : '';
        return {
          status: 500,
          body: {
            error: `The connector was removed, but its follow-up cleanup did not finish.${cleanupAdvice}`,
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
      const changed = await change(async () => {
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
      return changed ? ok({ connector: await show(id) }) : notFound;
    }
    if (action === 'case-actions' && tool === undefined) {
      if (record(request.body)['reset'] !== true) {
        throw new ConnectorRefusedError('reset must be true');
      }
      const changed = await change(async () => {
        if (!(await known(id))) return false;
        await caseActions.clear(id);
        return true;
      });
      return changed ? ok({ connector: await show(id) }) : notFound;
    }
    if (action === 'case-actions' && tool !== undefined) {
      const allowed = record(request.body)['allowed'];
      if (typeof allowed !== 'boolean')
        throw new ConnectorRefusedError('allowed must be true or false');
      const view = allowed ? await registry.view(id) : undefined;
      const candidate = view?.tools?.find((item) => item.name === tool);
      if (allowed && (view?.status.state !== 'connected' || candidate === undefined)) {
        throw new ConnectorRefusedError('Choose a connected writable tool for case requests');
      }
      const changed = await change(async () => {
        const current = await book.get(id);
        if (current === undefined) return false;
        if (allowed && (candidate === undefined || classifyTool(current, candidate) !== 'write')) {
          throw new ConnectorRefusedError('Choose a connected writable tool for case requests');
        }
        await caseActions.set(id, tool, allowed);
        return true;
      });
      return changed ? ok({ connector: await show(id) }) : notFound;
    }
    return undefined;
  };
}
