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

/** The person's limits on what the agent may push to them; times are `HH:MM` in the agent machine's local time. */
export interface IDeliverySettingsView {
  readonly dailyLimit: number;
  readonly quietHours: { readonly enabled: boolean; readonly from: string; readonly to: string };
  readonly digest: { readonly enabled: boolean; readonly at: string };
}

export interface IDeliveryStatusView {
  readonly settings: IDeliverySettingsView;
  readonly today: { readonly sent: number; readonly limit: number };
  readonly waitingInDigest: number;
}

export type TWebhookFormat = 'plain' | 'json';

/** The address the person gave to be notified at, as the agent tells it: never the address, only its host. */
export interface IWebhookView {
  readonly configured: boolean;
  readonly host?: string;
  readonly format: TWebhookFormat;
}

/** One message for the open page to show the person, as plain text. */
export interface IBrowserNotificationView {
  readonly id: number;
  readonly at: string;
  readonly kind: 'question' | 'digest' | 'test';
  readonly title: string;
  readonly text: string;
}

/** How many browsers are subscribed and, when checked, whether this browser is among them. */
export interface IPushStatusView {
  readonly subscribed: number;
  readonly supported: boolean;
  readonly current?: boolean;
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

export interface IFeedQuestionView {
  readonly caseId: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly allowsReply: boolean;
  /** Open until the person answers; withdrawn when the agent closed the case first. */
  readonly state: 'open' | 'answered' | 'withdrawn';
  readonly answer?: { readonly choice?: string; readonly reply?: string; readonly at: string };
  /** How the case closed, when it closed right after this answer. */
  readonly resolution?: string;
}

export interface IFeedItemView {
  readonly id: string;
  readonly at: string;
  readonly kind: 'report' | 'approval' | 'notice' | 'question';
  readonly title: string;
  readonly body: string;
  readonly goalId?: string;
  /** Present on an item of a goal a started task made: the launch it belongs to. */
  readonly launchId?: string;
  readonly approval?: {
    readonly tool: string;
    readonly detail: string;
    readonly state: 'pending' | 'approved' | 'denied' | 'expired';
  };
  readonly question?: IFeedQuestionView;
}

export type TCaseEventKind = 'observed' | 'noted' | 'asked' | 'answered' | 'closed';

export interface ICaseView {
  readonly id: string;
  readonly title: string;
  readonly origin: { readonly connectorId?: string; readonly source: string };
  readonly state: 'open' | 'closed';
  readonly notes: readonly { readonly at: string; readonly text: string }[];
  readonly question?: {
    readonly text: string;
    readonly options: readonly string[];
    readonly allowsReply: boolean;
    readonly askedAt: string;
    readonly feedItemId: string;
  };
  /** What happened on the case, oldest first. */
  readonly history: readonly {
    readonly at: string;
    readonly kind: TCaseEventKind;
    readonly text: string;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One of the offered choices, or a reply in the person's own words. */
export type TQuestionAnswer = { readonly choice: string } | { readonly reply: string };

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

export interface ITaskInputView {
  readonly name: string;
  readonly label: string;
  readonly kind: 'text' | 'choice' | 'number';
  readonly required: boolean;
  readonly default?: string | number;
  readonly choices?: readonly string[];
}

/** One thing the person does to get a task ready, as the agent names it. */
export type TTaskSetupStepView =
  | {
      readonly type: 'connect';
      readonly kind: 'mail' | 'calendar' | 'files' | 'chat' | 'notes' | 'other';
    }
  | {
      readonly type: 'choose-account';
      readonly accounts: readonly { readonly id: string; readonly title: string }[];
    }
  | {
      readonly type: 'allow-tool';
      readonly connectorId: string;
      readonly connectorTitle: string;
      readonly tool: string;
      /** `write` for a tool that changes something, which the person decides for themselves. */
      readonly decision: 'read' | 'write';
    }
  | { readonly type: 'reconnect'; readonly connectorId: string; readonly connectorTitle: string };

/**
 * What the agent says about whether a task can run now: ready, with the kinds of access it would use;
 * needing setup, with the steps left; or unavailable, with why. The page shows it and decides nothing.
 */
export type TTaskReadinessView =
  | { readonly state: 'ready'; readonly accesses: readonly string[] }
  | { readonly state: 'needs-setup'; readonly steps: readonly TTaskSetupStepView[] }
  | { readonly state: 'unavailable'; readonly reason: string };

/** A task the person can browse, as the agent describes it. */
export interface ITaskDefinitionView {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly category: string;
  readonly expectedResult: string;
  readonly inputs: readonly ITaskInputView[];
  /** Operations such as `mail.search`; the page puts them in plain words. */
  readonly capabilities: readonly string[];
  readonly effectCeiling: 'read-only' | 'draft' | 'approval-required-write';
  readonly completionEvidence: {
    readonly kind: 'source-readback' | 'receipt' | 'owner-confirmation';
    readonly description: string;
  };
  readonly readiness: TTaskReadinessView;
}

/** Where an offer's reason was read: a connected service, or a page of the person's library. */
export interface ITaskOfferEvidenceView {
  readonly kind: 'connector' | 'library';
  /** The service the item was read from; present for, and only for, a connector. */
  readonly connectorId?: string;
  /** The title the person gave the service. */
  readonly connectorTitle?: string;
  /** The agent's own reference to the item: plain text, which a source may have shaped. */
  readonly sourceItemId: string;
  readonly observedAt: string;
}

/** What an offer's decision reads as; the person can set one aside, snooze it or bring it back. */
export type TTaskOfferDecision =
  'open' | 'snoozed' | 'dismissed' | 'accepted' | 'expired' | 'superseded';

/**
 * A reason a task may be worth doing now. Every text in it came from a source, so it is plain text.
 * `readiness` is the agent's word on the task now, and is present only on an offer that is open.
 */
export interface ITaskOfferView {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionRevision: number;
  /** Absent when the task this offer names has left the catalog. */
  readonly definitionTitle?: string;
  readonly withdrawn: boolean;
  readonly source: 'built-in' | 'owner' | 'agent';
  readonly reason: string;
  /** What the source says, as a short factual statement. */
  readonly basis?: string;
  readonly contextRefs: readonly { readonly kind: string; readonly id: string }[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decision: TTaskOfferDecision;
  /** Suggested values for the task's inputs, which the person reads and changes. */
  readonly prefilled?: Readonly<Record<string, string>>;
  readonly evidence?: ITaskOfferEvidenceView;
  /** Present on a snoozed offer: when it comes back. */
  readonly snoozedUntil?: string;
  /** Present on an offer that was started: the launch it made. */
  readonly launchId?: string;
  readonly readiness?: TTaskReadinessView;
}

export interface ITaskOffersView {
  /** The offers the person may act on, and the ones already started. */
  readonly offers: readonly ITaskOfferView[];
  /** The offers the person dismissed or snoozed, which can be brought back. */
  readonly setAside: readonly ITaskOfferView[];
  /** What the agent could not read from what it saved, in words with no path. */
  readonly issues: readonly string[];
}

/** What the person decides about an offer; accepting is the task being started, never a decision. */
export type TTaskOfferDecisionRequest =
  | { readonly decision: 'dismissed' | 'open' }
  | { readonly decision: 'snoozed'; readonly snoozedUntil: string };

/** What a decision answers: the offer as it stands. */
export interface ITaskOfferDecisionView {
  readonly id: string;
  readonly decision: TTaskOfferDecision;
  readonly snoozedUntil?: string;
}

/** A request to start a task, kept by the agent before any goal exists. */
export interface ITaskLaunchView {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionRevision: number;
  readonly status: 'reserved' | 'launched' | 'failed' | 'cancelled';
  readonly goalId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Where a launch stands: starting, running or waiting for the person while its goal is active, and then
 * how the agent decided it ended from what it recorded. Only `verified` says the work was checked;
 * `unverified` says the run ended and nothing recorded confirms it.
 */
export type TTaskProgress =
  'starting' | 'running' | 'waiting' | 'verified' | 'unverified' | 'failed' | 'cancelled';

/** What the agent's own browser returned to the run: where it was asked to go, where it ended up, and a short excerpt. */
export interface ITaskEvidenceView {
  readonly kind: 'page-read';
  readonly tool: 'open' | 'view';
  readonly requested?: string;
  readonly address: string;
  readonly chars: number;
  readonly digest: string;
  /** Plain text from the page: shown as the text it is. */
  readonly excerpt?: string;
  readonly at: string;
}

/** A launch with where it stands, as the agent reads it back. Every text in it is plain text. */
export interface ITaskLaunchStatusView extends ITaskLaunchView {
  readonly progress: TTaskProgress;
  /** The agent's own words for why it stands there. */
  readonly reason: string;
  /** The run's report: the model's own account, never proof. */
  readonly report?: string;
  readonly evidence: readonly ITaskEvidenceView[];
  readonly decidedAt?: string;
}

/** What starting a task answers: the launch, and the goal made for it. */
export interface ITaskStartAnswer {
  readonly launch: ITaskLaunchView;
  readonly goalId: string;
}

/** The values the person gave a task, by the input's name. */
export type TTaskStartValues = Readonly<Record<string, string | number>>;

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
  'not-connected' | 'connecting' | 'connected' | 'needs-sign-in' | 'failed' | 'checking';
export type TToolAccess = 'read' | 'write' | 'blocked';
export type TConnectorKind = 'mail' | 'calendar' | 'files' | 'chat' | 'notes' | 'other';
/** How a service is signed in to; a view that carries none is signed in to with OAuth. */
export type TConnectorAuth = 'oauth' | 'token' | 'none';

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

/** What came of replacing a connector's token. */
export interface IReplaceTokenAnswer {
  readonly replaced: boolean;
  /** When it was not replaced: the service refused the token, or could not be reached. */
  readonly reason?: 'rejected' | 'unreachable';
  readonly status: IConnectorStatusView;
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
  readonly auth?: TConnectorAuth;
  /** The header a token goes in, when it is not the standard one; the name only, never the token. */
  readonly tokenHeader?: string;
  /** What the person registered with the service: public values only, never a secret. */
  readonly oauth?: {
    readonly clientId?: string;
    readonly scopes?: readonly string[];
    readonly authorizationParams?: Readonly<Record<string, string>>;
  };
  /** What the person wrote about what to be asked, in their own words; absent until they write some. */
  readonly attention?: string;
  /** The words that apply while the person has written none. */
  readonly defaultAttention: string;
  readonly status: IConnectorStatusView;
  /** Present while the connector is kept in sync. */
  readonly sync?: IConnectorSyncView;
  readonly tools?: readonly IConnectorToolView[];
  /** Tools the person has allowed case requests to propose; absent on older servers. */
  readonly caseActionTools?: readonly string[];
  /** Revision of the exact scope shown, for ordering the person's changes. */
  readonly caseActionRevision?: string;
  /** The saved setting could not be read and case requests cannot use it. */
  readonly caseActionScopeError?: boolean;
  /** A connector disconnect must finish before case settings can be used. */
  readonly caseActionTransition?: boolean;
  /** A new allow is being confirmed; the previous choices remain available for revocation. */
  readonly caseActionChangePending?: boolean;
}

/** A service the add form suggests: values to fill in, never a connection. */
export interface ICatalogEntryView {
  readonly title: string;
  readonly endpoint: string;
  readonly kind: TConnectorKind;
  readonly auth: TConnectorAuth;
  readonly tokenHeader?: string;
  /** A client the owner registered with the service for this agent; never its secret. */
  readonly oauth?: {
    readonly clientId?: string;
    readonly scopes?: readonly string[];
    readonly authorizationParams?: Readonly<Record<string, string>>;
  };
  readonly description?: string;
  /** Where the suggestion came from, as a word. */
  readonly source: string;
}

export interface IConnectorCatalogView {
  readonly entries: readonly ICatalogEntryView[];
  /** Whether the public registry answered; `off` when the owner turned it off. */
  readonly registry: 'ok' | 'unreachable' | 'off';
}

export interface IConnectorsListing {
  /** The path on this page's origin that a sign-in returns to. */
  readonly callbackPath: string;
  readonly connectors: readonly IConnectorView[];
}

/** The owner's explicit choice of a service a case may use. */
export interface ICaseConnectorBinding {
  readonly revision: string;
  readonly connectorId?: string;
  readonly error?: boolean;
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
  /** The person's delivery limits, today's pushes against them, and what waits for the digest. */
  delivery(): Promise<IDeliveryStatusView>;
  /** Save the limits; the agent refuses a value that is not valid, in words the page shows. */
  saveDelivery(settings: IDeliverySettingsView): Promise<IDeliveryStatusView>;
  /** Whether a notification address is set, its host and format; the address is never sent back. */
  webhook(): Promise<IWebhookView>;
  /** Keep the address the person typed; it goes with this one request and is not kept by the page. */
  saveWebhook(input: { url: string; format: TWebhookFormat }): Promise<IWebhookView>;
  removeWebhook(): Promise<IWebhookView>;
  /** Send the fixed test message to the address alone; the agent refuses in words that name no address. */
  testWebhook(): Promise<{ ok: true }>;
  /**
   * What arrived for this page after the last message it saw (`after`); with none, from now on. Asking is
   * what tells the agent a page is open to take a push.
   */
  notifications(after?: number): Promise<{
    readonly messages: readonly IBrowserNotificationView[];
    readonly latest: number;
  }>;
  /** How many browsers are subscribed to be notified while the page is closed. */
  pushStatus(endpoint?: string): Promise<IPushStatusView>;
  /** The public key a browser subscribes with. */
  pushKey(): Promise<{ readonly publicKey: string }>;
  /**
   * Tell the agent this browser subscribed, as the browser gives it (`PushSubscription.toJSON()`); the
   * agent refuses in words the page shows.
   */
  subscribePush(
    subscription: PushSubscriptionJSON,
    replacing?: readonly string[],
  ): Promise<IPushStatusView>;
  /** Tell the agent this browser no longer takes pushes. */
  unsubscribePush(endpoint: string): Promise<IPushStatusView>;
  /** Remove all browsers from this agent, including ones on an old origin. */
  clearPushSubscriptions(): Promise<IPushStatusView>;
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
  /** The work the person can browse, each with whether the agent can run it now. */
  taskDefinitions(): Promise<readonly ITaskDefinitionView[]>;
  /**
   * The offers made to the person, the ones they set aside, and anything the agent could not read.
   * Reading the list is how the agent learns the offers were shown; nothing else is recorded.
   */
  taskOffers(): Promise<ITaskOffersView>;
  /** One offer, as the agent judges it now. Asking is how the agent learns the person opened it. */
  taskOffer(offerId: string): Promise<ITaskOfferView>;
  /**
   * Dismiss an offer, snooze it until a time, or bring it back. None of these starts anything, and
   * the agent refuses any other decision.
   */
  decideTaskOffer(
    offerId: string,
    request: TTaskOfferDecisionRequest,
  ): Promise<ITaskOfferDecisionView>;
  /**
   * Start a task the agent said is ready, from an offer when `offerId` is given. One key is one
   * request: sending the same key again, for whatever reason, answers the same launch and goal.
   */
  startTask(
    definitionId: string,
    request: {
      readonly idempotencyKey: string;
      readonly inputs: TTaskStartValues;
      readonly offerId?: string;
    },
  ): Promise<ITaskStartAnswer>;
  /** The launches the person made, newest first, each with where it stands. */
  taskLaunches(): Promise<readonly ITaskLaunchStatusView[]>;
  /** One launch with where it stands now. */
  taskLaunch(launchId: string): Promise<ITaskLaunchStatusView>;
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
  /** Answer a question in the feed; the answer is recorded on its case. */
  answerQuestion(
    itemId: string,
    answer: TQuestionAnswer,
  ): Promise<{ item: IFeedItemView; case: ICaseView }>;
  /** Open cases first, then the ones closed last. */
  cases(signal?: AbortSignal): Promise<readonly ICaseView[]>;
  caseThread(id: string, signal?: AbortSignal): Promise<ICaseView>;
  caseConnector(id: string, signal?: AbortSignal): Promise<ICaseConnectorBinding>;
  setCaseConnector(
    id: string,
    connectorId: string | null,
    revision: string,
    signal?: AbortSignal,
  ): Promise<ICaseConnectorBinding>;
  fenceCaseConnector(
    id: string,
    revision: string,
    signal?: AbortSignal,
  ): Promise<ICaseConnectorBinding>;
  connectors(signal?: AbortSignal): Promise<IConnectorsListing>;
  connector(id: string, signal?: AbortSignal): Promise<{ connector: IConnectorView }>;
  connectorInventory(signal?: AbortSignal): Promise<IConnectorsListing>;
  connectorCaseActionScope(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ connector: IConnectorView }>;
  fenceCaseActionRequests(
    signal?: AbortSignal,
  ): Promise<IConnectorsListing & { fenced: readonly string[] }>;
  openConnectorCaseActions(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ connector: IConnectorView }>;
  /** Services to suggest when adding a connector, matching what was typed. */
  connectorCatalog(query: string): Promise<IConnectorCatalogView>;
  addConnector(input: {
    title: string;
    kind: TConnectorKind;
    endpoint: string;
    auth?: TConnectorAuth;
    tokenHeader?: string;
    clientId?: string;
    scopes?: readonly string[];
    authorizationParams?: Readonly<Record<string, string>>;
  }): Promise<{ connector: IConnectorView }>;
  /**
   * Sign in. With OAuth the page sends its own origin and opens the returned address in the person's
   * browser; with a token it sends the token instead. What the person typed (a client secret or a
   * token) goes with this one request and is not kept by the page.
   */
  connectConnector(
    id: string,
    input: { origin?: string; clientSecret?: string; token?: string },
  ): Promise<{ status: IConnectorStatusView }>;
  /**
   * Replace the token a connected service is using with a new one, without disconnecting. The agent
   * tries the new token apart from the one in use and swaps only when the service accepts it; the
   * answer says which, and why not.
   */
  replaceConnectorToken(id: string, token: string): Promise<IReplaceTokenAnswer>;
  disconnectConnector(id: string, forgetPulled?: boolean): Promise<IDisconnectAnswer>;
  removeConnector(id: string, forgetPulled?: boolean): Promise<IDisconnectAnswer>;
  /** How many library claims came from this connector. */
  connectorPulled(id: string): Promise<{ count: number }>;
  /** Keep the connector in sync every so many minutes, or stop with `null`. */
  setConnectorSync(id: string, everyMinutes: number | null): Promise<{ connector: IConnectorView }>;
  /**
   * What the person wants to be asked about for this connector, in their own words; empty text
   * returns it to the default. The agent refuses a text that looks like a secret or is too long.
   */
  setConnectorAttention(id: string, text: string): Promise<{ connector: IConnectorView }>;
  /** The person's decision about one tool; `null` returns it to what the service claims. */
  decideConnectorTool(
    id: string,
    tool: string,
    decision: TToolAccess | null,
  ): Promise<{ connector: IConnectorView }>;
  setConnectorCaseAction(
    id: string,
    tool: string,
    allowed: boolean,
    revision: string,
    signal?: AbortSignal,
  ): Promise<{ connector: IConnectorView }>;
  resetConnectorCaseActions(
    id: string,
    revision: string,
    signal?: AbortSignal,
  ): Promise<{ connector: IConnectorView }>;
  fenceConnectorCaseActions(
    id: string,
    revision: string,
    signal?: AbortSignal,
  ): Promise<{ connector: IConnectorView }>;
  saveProvider(provider: IProviderSettings): Promise<{ saved: true; restartRequired: boolean }>;
}

export function createPersonalApi(
  fetchImpl: TFetch = (input, init) => fetch(input, init),
): IPersonalApi {
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> => {
    const write = method !== 'GET';
    const response = await fetchImpl(`api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: write ? { 'content-type': 'application/json', [API_WRITE_HEADER]: '1' } : {},
      ...(signal !== undefined && { signal }),
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
    delivery: () => call('GET', 'delivery'),
    saveDelivery: (settings) => call('PUT', 'delivery', settings),
    webhook: () => call('GET', 'delivery/webhook'),
    saveWebhook: (input) => call('PUT', 'delivery/webhook', input),
    removeWebhook: () => call('DELETE', 'delivery/webhook'),
    testWebhook: () => call('POST', 'delivery/webhook/test'),
    notifications: (after) =>
      call('GET', after === undefined ? 'notifications' : `notifications?after=${after}`),
    pushStatus: (endpoint) =>
      endpoint === undefined ? call('GET', 'push') : call('POST', 'push/status', { endpoint }),
    pushKey: () => call('GET', 'push/key'),
    subscribePush: (subscription, replacing) =>
      call(
        'POST',
        'push/subscribe',
        replacing === undefined ? subscription : { ...subscription, replacing },
      ),
    unsubscribePush: (endpoint) => call('DELETE', 'push/subscribe', { endpoint }),
    clearPushSubscriptions: () => call('DELETE', 'push/subscriptions'),
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
    taskDefinitions: async () =>
      (await call<{ definitions: ITaskDefinitionView[] }>('GET', 'tasks/definitions')).definitions,
    taskOffers: () => call('GET', 'tasks/offers'),
    taskOffer: async (offerId) =>
      (await call<{ offer: ITaskOfferView }>('GET', `tasks/offers/${id(offerId)}`)).offer,
    decideTaskOffer: async (offerId, request) =>
      (
        await call<{ offer: ITaskOfferDecisionView }>(
          'POST',
          `tasks/offers/${id(offerId)}/decision`,
          request,
        )
      ).offer,
    startTask: (definitionId, request) =>
      call('POST', `tasks/definitions/${id(definitionId)}/start`, request),
    taskLaunches: async () =>
      (await call<{ launches: ITaskLaunchStatusView[] }>('GET', 'tasks/launches')).launches,
    taskLaunch: async (launchId) =>
      (await call<{ launch: ITaskLaunchStatusView }>('GET', `tasks/launches/${id(launchId)}`))
        .launch,
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
    answerQuestion: (itemId, answer) => call('POST', `feed/${id(itemId)}/answer`, answer),
    cases: async (signal) =>
      (await call<{ cases: ICaseView[] }>('GET', 'cases', undefined, signal)).cases,
    caseThread: async (caseId, signal) =>
      (await call<{ case: ICaseView }>('GET', `cases/${id(caseId)}`, undefined, signal)).case,
    caseConnector: async (caseId, signal) =>
      (
        await call<{ binding: ICaseConnectorBinding }>(
          'GET',
          `cases/${id(caseId)}/connector`,
          undefined,
          signal,
        )
      ).binding,
    setCaseConnector: async (caseId, connectorId, revision, signal) =>
      (
        await call<{ binding: ICaseConnectorBinding }>(
          'POST',
          `cases/${id(caseId)}/connector`,
          { connectorId, revision },
          signal,
        )
      ).binding,
    fenceCaseConnector: async (caseId, revision, signal) =>
      (
        await call<{ binding: ICaseConnectorBinding }>(
          'POST',
          `cases/${id(caseId)}/connector`,
          { fence: true, revision },
          signal,
        )
      ).binding,
    connectors: (signal) => call('GET', 'connectors', undefined, signal),
    connectorCatalog: (query) =>
      call('GET', `connectors/catalog?query=${encodeURIComponent(query)}`),
    addConnector: (input) => call('POST', 'connectors', input),
    connectConnector: (connectorId, { origin, clientSecret, token }) =>
      call('POST', `connectors/${id(connectorId)}/connect`, {
        ...(origin !== undefined && { origin }),
        ...(clientSecret !== undefined && clientSecret !== '' && { clientSecret }),
        ...(token !== undefined && token !== '' && { token }),
      }),
    replaceConnectorToken: (connectorId, token) =>
      call('POST', `connectors/${id(connectorId)}/token`, { token }),
    disconnectConnector: (connectorId, forgetPulled = false) =>
      call('POST', `connectors/${id(connectorId)}/disconnect`, { forgetPulled }),
    removeConnector: (connectorId, forgetPulled = false) =>
      call('POST', `connectors/${id(connectorId)}/remove`, { forgetPulled }),
    connectorPulled: (connectorId) => call('GET', `connectors/${id(connectorId)}/pulled`),
    connector: (connectorId, signal) =>
      call('GET', `connectors/${id(connectorId)}`, undefined, signal),
    connectorInventory: (signal) =>
      call('GET', 'connectors/case-actions/summary', undefined, signal),
    connectorCaseActionScope: (connectorId, signal) =>
      call('GET', `connectors/${id(connectorId)}/case-actions`, undefined, signal),
    setConnectorSync: (connectorId, everyMinutes) =>
      call('POST', `connectors/${id(connectorId)}/sync`, { everyMinutes }),
    setConnectorAttention: (connectorId, text) =>
      call('PUT', `connectors/${id(connectorId)}/attention`, { text }),
    decideConnectorTool: (connectorId, tool, decision) =>
      call('POST', `connectors/${id(connectorId)}/tools/${id(tool)}`, { decision }),
    setConnectorCaseAction: (connectorId, tool, allowed, revision, signal) =>
      call(
        'POST',
        `connectors/${id(connectorId)}/case-actions`,
        {
          tool,
          allowed,
          revision,
        },
        signal,
      ),
    resetConnectorCaseActions: (connectorId, revision, signal) =>
      call(
        'POST',
        `connectors/${id(connectorId)}/case-actions`,
        {
          reset: true,
          revision,
        },
        signal,
      ),
    fenceCaseActionRequests: (signal) => call('POST', 'connectors/case-actions/fence', {}, signal),
    openConnectorCaseActions: (connectorId, signal) =>
      call('POST', `connectors/${id(connectorId)}/case-actions`, { open: true }, signal),
    fenceConnectorCaseActions: (connectorId, revision, signal) =>
      call('POST', `connectors/${id(connectorId)}/case-actions`, { fence: revision }, signal),
  };
}
