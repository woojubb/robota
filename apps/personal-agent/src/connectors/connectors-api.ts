/**
 * The connectors' part of the personal API: what the Connectors tab lists and does. Nothing here
 * returns a token, a code or any text derived from one; a connection's state is a fixed word.
 */
import {
  ConnectorRefusedError,
  countPulled,
  forgetPulled,
} from '@robota-sdk/agent-product/personal';

import { CONSENT_CALLBACK_PATH } from './consent.js';

import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type {
  ConnectorBook,
  ConnectorRegistry,
  ConnectorSync,
  IConnectorSyncStatus,
  IConnectorView,
  KnowledgeWiki,
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

function present(view: IConnectorView, sync?: IConnectorSyncStatus): Record<string, unknown> {
  const { connector, status, tools } = view;
  return {
    id: connector.id,
    title: connector.title,
    kind: connector.kind,
    protocol: connector.protocol,
    endpoint: connector.endpoint,
    ...(connector.oauth !== undefined && { oauth: connector.oauth }),
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

/** Answers `connectors/...` requests, or `undefined` for a path that is not one. */
export function createConnectorsApi(options: IConnectorsApiOptions): TConnectorsApi {
  const { registry, book, sync, wiki } = options;
  /** A connector as the page shows it, with how its sync stands. */
  const show = async (id: string, refresh = false): Promise<Record<string, unknown>> =>
    present(await registry.view(id, { refresh }), await sync.status(id));
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
              present(view, await sync.status(view.connector.id)),
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
        const connector = await book.create({
          title: text(body, 'title'),
          kind: text(body, 'kind') as TConnectorKind,
          protocol: 'mcp',
          endpoint: text(body, 'endpoint'),
          ...((clientId !== undefined && clientId !== '') || (scopes?.length ?? 0) > 0
            ? {
                oauth: {
                  ...(clientId !== undefined && clientId !== '' && { clientId }),
                  ...(scopes !== undefined && scopes.length > 0 && { scopes: scopes as string[] }),
                },
              }
            : {}),
        });
        return ok({ connector: await show(connector.id) });
      }
      return undefined;
    }

    if (!(await known(id))) return notFound;
    if (action === undefined && method === 'GET') {
      return ok({ connector: await show(id, request.query.get('refresh') === '1') });
    }
    if (action === 'pulled' && method === 'GET') return ok({ count: await countPulled(wiki, id) });
    if (method !== 'POST') return undefined;
    if (action === 'connect') {
      const origin = text(record(request.body), 'origin');
      const normalized = URL.canParse(origin) ? new URL(origin).origin : undefined;
      if (normalized === undefined || !options.origins().includes(normalized)) {
        throw new ConnectorRefusedError('the agent is not reached at that origin');
      }
      return ok({ status: await registry.signIn(id, { origin: normalized }) });
    }
    if (action === 'disconnect') return leave(id, request.body, () => registry.disconnect(id));
    if (action === 'remove') return leave(id, request.body, () => registry.remove(id));
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
      await registry.decide(id, tool, decision === null ? undefined : (decision as TToolDecision));
      return ok({ connector: await show(id) });
    }
    return undefined;
  };
}
