/**
 * The task-catalog part of the personal API: the definitions the person can browse with whether each
 * can run, the offers made to them, and the one route that starts a task. Starting is the only thing
 * here that changes anything, and what every route answers holds no path of this machine and no value
 * of a connector.
 */
import { LaunchRefusedError } from './launch/types.js';
import { LAUNCH_LIMITS } from './launch/validate.js';

import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type { ITaskCatalog } from './catalog.js';
import type { ILaunchCoordinator } from './launch/coordinator.js';

/** Answers the task routes, or `undefined` for a request that is not one of them. */
export type TTaskCatalogApi = (
  request: ILoopbackGuiApiRequest,
) => Promise<ILoopbackGuiApiResponse | undefined>;

/** How many launches the list answers with, newest first. */
const LAUNCHES_SHOWN = 50;
const START_KEYS = ['idempotencyKey', 'inputs'];

const ok = (body: unknown): ILoopbackGuiApiResponse => ({ status: 200, body });
const fail = (status: number, body: Record<string, unknown>): ILoopbackGuiApiResponse => ({
  status,
  body,
});

/** The refusals of a start, each with the status and the extra the page needs to explain it. */
function refusal(error: LaunchRefusedError): ILoopbackGuiApiResponse {
  const { readiness, launch } = error.detail;
  switch (error.kind) {
    case 'invalid':
      return fail(400, { error: error.message });
    case 'too-large':
      return fail(413, { error: error.message });
    case 'unknown':
      return fail(404, { error: error.message });
    case 'conflict':
      return fail(409, { error: error.message });
    case 'not-ready':
      return fail(422, { error: error.message, ...(readiness !== undefined && { readiness }) });
    case 'stale':
      return fail(422, { error: error.message, ...(launch !== undefined && { launch }) });
    case 'failed':
      return fail(500, { error: error.message, ...(launch !== undefined && { launch }) });
  }
}

/** The body of a start request: an object with the key and the values and nothing else, and small. */
function startBody(body: unknown): { idempotencyKey: unknown; inputs: unknown } {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new LaunchRefusedError('invalid', 'The request must be a JSON object');
  if (JSON.stringify(body).length > LAUNCH_LIMITS.body)
    throw new LaunchRefusedError('too-large', 'The request is too large');
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!START_KEYS.includes(key))
      throw new LaunchRefusedError('invalid', 'The request has a field that is not part of it');
  return { idempotencyKey: record['idempotencyKey'], inputs: record['inputs'] };
}

export function createTaskCatalogApi(
  catalog: ITaskCatalog,
  launches: ILaunchCoordinator,
): TTaskCatalogApi {
  return async ({ method, segments, body }) => {
    const [area, collection, id, action, extra] = segments;
    if (area !== 'tasks' || extra !== undefined) return undefined;
    if (
      method === 'POST' &&
      collection === 'definitions' &&
      id !== undefined &&
      action === 'start'
    ) {
      try {
        const started = await launches.start({ definitionId: id, ...startBody(body) });
        return {
          status: started.created ? 201 : 200,
          body: { launch: started.launch, goalId: started.goalId },
        };
      } catch (error) {
        if (error instanceof LaunchRefusedError) return refusal(error);
        throw error;
      }
    }
    if (method !== 'GET' || action !== undefined) return undefined;
    if (collection === 'definitions' && id === undefined)
      return ok({ definitions: await catalog.listDefinitions() });
    if (collection === 'offers' && id === undefined) {
      const { offers, issues } = await catalog.listOffers();
      return ok({ offers, issues });
    }
    if (collection === 'launches') {
      if (id === undefined) return ok({ launches: await launches.list(LAUNCHES_SHOWN) });
      const launch = await launches.get(id);
      return launch === undefined
        ? fail(404, { error: 'There is no such launch.' })
        : ok({ launch });
    }
    return undefined;
  };
}
