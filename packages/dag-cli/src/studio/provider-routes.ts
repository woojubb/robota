/**
 * PROVIDER-010 — `dag studio`'s provider routes (`/api/providers*`) plus the process-local record of
 * which provider the studio is currently pointed at. Split out of `http-server.ts` to keep that file
 * within its size budget (SEC-006 added the request guards there); behaviour is unchanged.
 */
import { listAvailableProviders, resolveProvider } from '../providers/index.js';

import { jsonReply, readBody } from './http-io.js';

import type { IncomingMessage, ServerResponse } from 'node:http';

interface IStudioProviderState {
  providerId: string;
}

// PROVIDER-010: studio provider state — defaults to local; switched via POST /api/providers/connect.
const studioProviderState: IStudioProviderState = {
  providerId: 'local',
};

export async function routeProvidersList(res: ServerResponse): Promise<void> {
  jsonReply(res, 200, {
    providers: listAvailableProviders(),
    active: studioProviderState,
  });
}

export async function routeProvidersConnect(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    // allow-fallback: body read error returns a structured 400 to the studio UI
    jsonReply(res, 400, { error: 'Failed to read request body.' });
    return;
  }
  let parsed: { providerId?: string; serverUrl?: string };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    // allow-fallback: invalid JSON from client returns a structured 400
    jsonReply(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  const { providerId } = parsed;
  if (typeof providerId !== 'string' || providerId.length === 0) {
    jsonReply(res, 400, { error: 'providerId is required.' });
    return;
  }
  studioProviderState.providerId = providerId;
  jsonReply(res, 200, { ok: true, active: studioProviderState });
}

export async function routeProvidersNodes(res: ServerResponse): Promise<void> {
  try {
    // allow-fallback: provider connection failure returns 502 with the underlying error message
    const provider = await resolveProvider({ provider: studioProviderState.providerId });
    const nodes = await provider.listNodes();
    jsonReply(res, 200, { providerId: provider.providerId, nodes });
  } catch (err) {
    // allow-fallback: surface upstream error so the studio can show a connection failure
    const message = err instanceof Error ? err.message : String(err);
    jsonReply(res, 502, { error: message });
  }
}
