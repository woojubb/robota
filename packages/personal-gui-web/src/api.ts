/**
 * The personal agent's API as this page sees it: JSON under `api/`, relative to the page, so it rides
 * the access cookie of the session path the page was served from. A request that changes something
 * carries the header the server requires of writes.
 */

export type TClaimOrigin = 'owner' | 'agent' | 'web' | 'mail' | 'peer' | 'tool';

export interface IClaimView {
  readonly id: string;
  readonly text: string;
  readonly source: {
    readonly origin: TClaimOrigin;
    readonly reference?: string;
    readonly sessionId?: string;
    readonly at: string;
  };
  readonly validFrom: string;
  readonly validTo?: string;
  readonly supersededBy?: string;
}

export interface IPageView {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly claims: readonly IClaimView[];
  readonly links: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IPageSummary {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly currentClaims: number;
  readonly updatedAt: string;
}

export interface ILogEntry {
  readonly at: string;
  readonly action: string;
  readonly pageId?: string;
  readonly summary: string;
}

export interface ILintReport {
  readonly contradictions: readonly {
    readonly pageId: string;
    readonly claimIds: readonly string[];
  }[];
  readonly stale: readonly { readonly pageId: string; readonly claimId: string }[];
  readonly orphans: readonly string[];
  readonly missingLinks: readonly { readonly from: string; readonly to: string }[];
}

export interface ISearchResult {
  readonly page: IPageSummary;
  readonly matches: readonly string[];
}

export interface IProviderSettings {
  readonly type: string;
  readonly model: string;
  readonly baseURL?: string;
  readonly apiKeyEnv?: string;
}

export interface ISettings {
  readonly provider?: IProviderSettings;
  readonly providerTypes: readonly string[];
  readonly stateDir: string;
  readonly browser: { readonly available: boolean };
}

export type TGoalStatus = 'active' | 'running' | 'waiting' | 'paused' | 'done' | 'failed';

export interface IGoalView {
  readonly id: string;
  readonly title: string;
  readonly instructions: string;
  readonly everyMinutes?: number;
  readonly readOnly: boolean;
  readonly status: TGoalStatus;
  readonly nextRunAt?: string;
  readonly lastRunAt?: string;
  readonly createdAt: string;
}

export interface IGoalRunView {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly outcome?: 'done' | 'failed' | 'interrupted';
  readonly report?: string;
  readonly actions: readonly {
    readonly at: string;
    readonly tool: string;
    readonly detail: string;
    readonly outcome: string;
  }[];
}

export interface IFeedItemView {
  readonly id: string;
  readonly at: string;
  readonly kind: 'report' | 'approval' | 'notice';
  readonly title: string;
  readonly body: string;
  readonly goalId?: string;
  readonly approval?: {
    readonly tool: string;
    readonly detail: string;
    readonly state: 'pending' | 'approved' | 'denied' | 'expired';
  };
}

export const API_WRITE_HEADER = 'x-robota-api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface IPersonalApi {
  listPages(): Promise<readonly IPageSummary[]>;
  getPage(id: string): Promise<IPageView>;
  createPage(input: { title: string; kind: string; text: string }): Promise<{ pageId: string }>;
  addClaim(
    pageId: string,
    input: { text: string; supersedes?: string },
  ): Promise<{ claimId: string }>;
  forgetClaim(claimId: string): Promise<{ removed: number }>;
  forgetPage(pageId: string): Promise<{ removed: number }>;
  log(): Promise<readonly ILogEntry[]>;
  lint(): Promise<ILintReport>;
  search(query: string): Promise<readonly ISearchResult[]>;
  settings(): Promise<ISettings>;
  goals(): Promise<readonly IGoalView[]>;
  goal(id: string): Promise<{ goal: IGoalView; runs: readonly IGoalRunView[] }>;
  createGoal(input: {
    title: string;
    instructions: string;
    everyMinutes?: number;
    readOnly: boolean;
  }): Promise<{ goal: IGoalView }>;
  goalAction(id: string, action: 'pause' | 'resume' | 'run' | 'stop'): Promise<unknown>;
  feed(): Promise<readonly IFeedItemView[]>;
  answerFeed(id: string, action: 'approve' | 'deny' | 'dismiss'): Promise<unknown>;
  saveProvider(provider: IProviderSettings): Promise<{ saved: true; restartRequired: boolean }>;
}

export function createPersonalApi(
  fetchImpl: TFetch = (input, init) => fetch(input, init),
): IPersonalApi {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const write = method !== 'GET';
    const response = await fetchImpl(`api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: write ? { 'content-type': 'application/json', [API_WRITE_HEADER]: '1' } : {},
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok)
      throw new ApiError(response.status, parsed?.error ?? `Request failed (${response.status})`);
    return parsed as T;
  };
  const id = (value: string): string => encodeURIComponent(value);
  return {
    listPages: async () => (await call<{ pages: IPageSummary[] }>('GET', 'wiki/pages')).pages,
    getPage: async (pageId) =>
      (await call<{ page: IPageView }>('GET', `wiki/pages/${id(pageId)}`)).page,
    createPage: (input) => call('POST', 'wiki/pages', input),
    addClaim: (pageId, input) => call('POST', `wiki/pages/${id(pageId)}/claims`, input),
    forgetClaim: (claimId) => call('POST', 'wiki/forget', { claimId }),
    forgetPage: (pageId) => call('POST', 'wiki/forget', { pageId }),
    log: async () => (await call<{ entries: ILogEntry[] }>('GET', 'wiki/log')).entries,
    lint: () => call('GET', 'wiki/lint'),
    search: async (query) =>
      (await call<{ results: ISearchResult[] }>('GET', `search?q=${encodeURIComponent(query)}`))
        .results,
    settings: () => call('GET', 'settings'),
    saveProvider: (provider) => call('PUT', 'settings/provider', provider),
    goals: async () => (await call<{ goals: IGoalView[] }>('GET', 'goals')).goals,
    goal: (goalId) => call('GET', `goals/${id(goalId)}`),
    createGoal: (input) => call('POST', 'goals', input),
    goalAction: (goalId, action) => call('POST', `goals/${id(goalId)}/${action}`),
    feed: async () => (await call<{ items: IFeedItemView[] }>('GET', 'feed')).items,
    answerFeed: (itemId, action) => call('POST', `feed/${id(itemId)}/${action}`),
  };
}
