/**
 * The task-catalog part of the personal API: the definitions the person can browse with whether each
 * can run, and the offers made to them. Both routes only read; nothing here starts work, and what they
 * answer holds no path of this machine and no value of a connector.
 */
import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type { ITaskCatalog } from './catalog.js';

/** Answers the task routes, or `undefined` for a request that is not one of them. */
export type TTaskCatalogApi = (
  request: ILoopbackGuiApiRequest,
) => Promise<ILoopbackGuiApiResponse | undefined>;

const ok = (body: unknown): ILoopbackGuiApiResponse => ({ status: 200, body });

export function createTaskCatalogApi(catalog: ITaskCatalog): TTaskCatalogApi {
  return async ({ method, segments }) => {
    const [area, collection, extra] = segments;
    if (area !== 'tasks' || extra !== undefined || method !== 'GET') return undefined;
    if (collection === 'definitions') return ok({ definitions: await catalog.listDefinitions() });
    if (collection === 'offers') {
      const { offers, issues } = await catalog.listOffers();
      return ok({ offers, issues });
    }
    return undefined;
  };
}
