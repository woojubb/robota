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

export interface IIdeaView {
  readonly id: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly origin: 'owner' | 'agent';
  readonly status: 'open' | 'taken-up' | 'archived';
  readonly takenUpAs?: string;
  readonly createdAt: string;
}

export interface ISpaceView {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly tag: string;
  /** Library pages pinned to the space that still exist. */
  readonly pinned: readonly { readonly id: string; readonly title: string }[];
  /** The first message of a chat started in the space. */
  readonly opening: string;
}

export interface ISideChatView {
  /** The side chat's session id. */
  readonly id: string;
  readonly parentId?: string;
  readonly title: string;
  readonly createdAt: string;
}

export interface IBrowserActivityView {
  readonly at: string;
  readonly action: 'open' | 'click' | 'type' | 'submit' | 'stop' | 'failed';
  readonly summary: string;
  readonly url?: string;
}

export interface IBrowserWatchView {
  readonly available: boolean;
  readonly page?: { readonly url: string; readonly title: string };
  readonly activity: readonly IBrowserActivityView[];
  readonly held: readonly {
    readonly id: string;
    readonly method: string;
    readonly url: string;
    readonly fields: readonly string[];
  }[];
}

export interface IBrowserScreenshotView {
  readonly url: string;
  readonly title: string;
  /** A `data:image/png;base64,…` URL. */
  readonly png: string;
}

export type TConnectorState =
  'not-connected' | 'connecting' | 'connected' | 'needs-sign-in' | 'failed';
export type TToolAccess = 'read' | 'write' | 'blocked';
export type TConnectorKind = 'mail' | 'calendar' | 'files' | 'chat' | 'notes' | 'other';

export interface IConnectorToolView {
  readonly name: string;
  readonly description?: string;
  /** What the agent treats the tool as: reading is allowed, writing waits for the person. */
  readonly access: TToolAccess;
  /** The person's own decision, when there is one. */
  readonly decision?: TToolAccess;
  /** What the service claims about the tool. */
  readonly hints?: { readonly readOnly?: boolean; readonly destructive?: boolean };
}

export interface IConnectorStatusView {
  readonly state: TConnectorState;
  /** Why a sign-in failed, as a fixed word. */
  readonly reason?: string;
  /** While connecting: where the person's browser goes to consent. */
  readonly authorizationUrl?: string;
  readonly redirectUri?: string;
  /** While connected: the scope words the service says it granted. */
  readonly scope?: string;
}

export interface IConnectorSyncView {
  /** The goal that keeps the connector in sync; it is also listed with the person's goals. */
  readonly goalId: string;
  readonly everyMinutes: number;
  /** Where the goal stands: a sync the person paused among their goals does not run. */
  readonly status: TGoalStatus;
  readonly lastRunAt?: string;
  readonly nextRunAt?: string;
}

export interface IConnectorView {
  readonly id: string;
  readonly title: string;
  readonly kind: TConnectorKind;
  readonly endpoint: string;
  readonly status: IConnectorStatusView;
  /** Present while the connector is kept in sync. */
  readonly sync?: IConnectorSyncView;
  readonly tools?: readonly IConnectorToolView[];
}

export interface IConnectorsListing {
  /** The path on this page's origin that a sign-in returns to. */
  readonly callbackPath: string;
  readonly connectors: readonly IConnectorView[];
}

export type TRevocation = 'revoked' | 'partial' | 'unsupported' | 'failed' | 'not-attempted';

export interface IDisconnectView {
  readonly removed: boolean;
  readonly revocation: TRevocation;
}

export interface IDisconnectAnswer {
  readonly outcome: IDisconnectView;
  /** How many library claims were forgotten, when the person asked to forget what was pulled. */
  readonly forgotten?: number;
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
  ideas(tag?: string): Promise<readonly IIdeaView[]>;
  spaces(): Promise<readonly ISpaceView[]>;
  saveSpace(input: {
    id?: string;
    name: string;
    instructions: string;
  }): Promise<{ space: ISpaceView }>;
  removeSpace(id: string): Promise<unknown>;
  sideChats(): Promise<readonly ISideChatView[]>;
  browser(): Promise<IBrowserWatchView>;
  browserScreenshot(): Promise<IBrowserScreenshotView | null>;
  stopBrowser(): Promise<unknown>;
  /** The person's tab order: fixed tab ids and `space:<id>`. */
  tabs(): Promise<readonly string[]>;
  saveTabs(tabs: readonly string[]): Promise<{ tabs: readonly string[] }>;
  recordSideChat(input: {
    id: string;
    parentId?: string;
    title: string;
  }): Promise<{ sideChat: ISideChatView }>;
  removeSideChat(id: string): Promise<unknown>;
  pinPage(spaceId: string, pageId: string, pinned: boolean): Promise<{ space: ISpaceView }>;
  addIdea(input: { text: string; tags: readonly string[] }): Promise<{ idea: IIdeaView }>;
  ideaAction(
    id: string,
    action: 'archive' | 'remove' | 'make-goal',
  ): Promise<{ idea?: IIdeaView; goal?: IGoalView }>;
  answerFeed(id: string, action: 'approve' | 'deny' | 'dismiss'): Promise<unknown>;
  connectors(): Promise<IConnectorsListing>;
  addConnector(input: {
    title: string;
    kind: TConnectorKind;
    endpoint: string;
    clientId?: string;
    scopes?: readonly string[];
  }): Promise<{ connector: IConnectorView }>;
  /** Start the sign-in; the page opens the returned address in the person's browser. */
  connectConnector(id: string, origin: string): Promise<{ status: IConnectorStatusView }>;
  disconnectConnector(id: string, forgetPulled?: boolean): Promise<IDisconnectAnswer>;
  removeConnector(id: string, forgetPulled?: boolean): Promise<IDisconnectAnswer>;
  /** How many library claims came from this connector. */
  connectorPulled(id: string): Promise<{ count: number }>;
  /** Keep the connector in sync every so many minutes, or stop with `null`. */
  setConnectorSync(id: string, everyMinutes: number | null): Promise<{ connector: IConnectorView }>;
  /** The person's decision about one tool; `null` returns it to what the service claims. */
  decideConnectorTool(
    id: string,
    tool: string,
    decision: TToolAccess | null,
  ): Promise<{ connector: IConnectorView }>;
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
    ideas: async (tag) =>
      (
        await call<{ ideas: IIdeaView[] }>(
          'GET',
          tag === undefined ? 'ideas' : `ideas?tag=${encodeURIComponent(tag)}`,
        )
      ).ideas,
    addIdea: (input) => call('POST', 'ideas', input),
    spaces: async () => (await call<{ spaces: ISpaceView[] }>('GET', 'spaces')).spaces,
    saveSpace: ({ id: spaceId, ...input }) =>
      call('POST', spaceId === undefined ? 'spaces' : `spaces/${id(spaceId)}/update`, input),
    removeSpace: (spaceId) => call('POST', `spaces/${id(spaceId)}/remove`),
    sideChats: async () =>
      (await call<{ sideChats: ISideChatView[] }>('GET', 'side-chats')).sideChats,
    recordSideChat: (input) => call('POST', 'side-chats', input),
    browser: () => call('GET', 'browser'),
    browserScreenshot: async () =>
      (await call<{ screenshot: IBrowserScreenshotView | null }>('GET', 'browser/screenshot'))
        .screenshot,
    stopBrowser: () => call('POST', 'browser/stop'),
    tabs: async () => (await call<{ tabs: string[] }>('GET', 'layout')).tabs,
    saveTabs: (tabs) => call('POST', 'layout', { tabs }),
    removeSideChat: (chatId) => call('POST', `side-chats/${id(chatId)}/remove`),
    pinPage: (spaceId, pageId, pinned) =>
      call('POST', `spaces/${id(spaceId)}/${pinned ? 'pin' : 'unpin'}`, { pageId }),
    ideaAction: (ideaId, action) => call('POST', `ideas/${id(ideaId)}/${action}`),
    answerFeed: (itemId, action) => call('POST', `feed/${id(itemId)}/${action}`),
    connectors: () => call('GET', 'connectors'),
    addConnector: (input) => call('POST', 'connectors', input),
    connectConnector: (connectorId, origin) =>
      call('POST', `connectors/${id(connectorId)}/connect`, { origin }),
    disconnectConnector: (connectorId, forgetPulled = false) =>
      call('POST', `connectors/${id(connectorId)}/disconnect`, { forgetPulled }),
    removeConnector: (connectorId, forgetPulled = false) =>
      call('POST', `connectors/${id(connectorId)}/remove`, { forgetPulled }),
    connectorPulled: (connectorId) => call('GET', `connectors/${id(connectorId)}/pulled`),
    setConnectorSync: (connectorId, everyMinutes) =>
      call('POST', `connectors/${id(connectorId)}/sync`, { everyMinutes }),
    decideConnectorTool: (connectorId, tool, decision) =>
      call('POST', `connectors/${id(connectorId)}/tools/${id(tool)}`, { decision }),
  };
}
