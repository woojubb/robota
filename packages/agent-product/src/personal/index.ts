/**
 * The personal capability pack: what a personal agent does, independent of how it is hosted. A
 * composition root lends it a state directory and the live session; everything else is here.
 */
export { KnowledgeWiki, SensitiveContentRefusedError, pageIdFor } from './knowledge/wiki.js';
export type {
  ILintReport,
  IKnowledgeWikiOptions,
  IRememberInput,
  IRememberResult,
  ISearchHit,
} from './knowledge/wiki.js';
export { createFileKnowledgeStore } from './knowledge/file-store.js';
export { createMemoryKnowledgeStore } from './knowledge/memory-store.js';
export { renderPageForModel, renderPageMarkdown } from './knowledge/render.js';
export { PAGE_KINDS } from './knowledge/types.js';
export type {
  IClaim,
  IClaimSource,
  IKnowledgeStore,
  IWikiLogEntry,
  IWikiPage,
  TClaimOrigin,
  TPageKind,
  TWikiLogAction,
} from './knowledge/types.js';
export { WIKI_INSTRUCTIONS, WIKI_TOOL_NAMES, createWikiTools } from './knowledge/tools.js';
export { BrowserNavigationRefusedError, BrowserUnavailableError } from './browser/types.js';
export type {
  IBrowserActionResult,
  IBrowserMark,
  IBrowserPort,
  IBrowserSnapshot,
  IBrowserView,
  IHeldSubmission,
} from './browser/types.js';
export {
  BROWSER_INSTRUCTIONS,
  BROWSER_TOOL_NAMES,
  createBrowserTools,
  renderView,
} from './browser/tools.js';
export { GoalBook, GoalRefusedError } from './goals/goal-book.js';
export type { ICreateGoalInput, IGoalBookOptions } from './goals/goal-book.js';
export { CASE_URGENCIES, CaseBook, CaseRefusedError } from './cases/case-book.js';
export type {
  IAnswerInput,
  IAskInput,
  ICaseAskedEvent,
  ICaseBookOptions,
  IOpenCaseInput,
} from './cases/case-book.js';
export { createFileCaseStore, createMemoryCaseStore } from './cases/stores.js';
export { CASE_INSTRUCTIONS, CASE_TOOL_NAMES, createCaseTools } from './cases/tools.js';
export { caseTurnInstructions, caseTurnPrompt, caseTurnTools } from './cases/turn.js';
export type {
  ICase,
  ICaseEvent,
  ICaseNote,
  ICaseOrigin,
  ICaseQuestion,
  ICaseStore,
  TCaseEventKind,
  TCaseState,
  TCaseUrgency,
} from './cases/types.js';
export {
  DAILY_LIMIT_MAX,
  DEFAULT_DELIVERY_SETTINGS,
  DeliveryRefusedError,
  decideDelivery,
} from './delivery/policy.js';
export type { IDecideDeliveryInput } from './delivery/policy.js';
export { QuestionDelivery } from './delivery/question-delivery.js';
export type { IQuestionDeliveryOptions } from './delivery/question-delivery.js';
export { createFileDeliveryStores, createMemoryDeliveryStore } from './delivery/stores.js';
export type {
  IDeliveryFeed,
  IDeliveryMessage,
  IDeliverySettings,
  IDeliverySink,
  IDeliveryState,
  IDeliveryStatus,
  IDeliveryStore,
  IDigestSchedule,
  IQuietHours,
  TDelivery,
} from './delivery/types.js';
export { createFileGoalStore } from './goals/file-store.js';
export { createMemoryGoalStore } from './goals/memory-store.js';
export {
  GOAL_INSTRUCTIONS,
  GOAL_TOOL_NAMES,
  createGoalTools,
  goalRunInstructions,
  renderGoal,
} from './goals/tools.js';
export type {
  IFeedItem,
  IFeedQuestion,
  IGoal,
  IGoalAction,
  IGoalRun,
  IGoalStore,
  IQuestionAnswer,
  TApprovalState,
  TFeedKind,
  TGoalRunOutcome,
  TGoalStatus,
  TQuestionState,
} from './goals/types.js';
export {
  IdeaBook,
  IdeaRefusedError,
  createFileIdeaStore,
  createMemoryIdeaStore,
} from './ideas/ideas.js';
export type {
  IIdea,
  IIdeaBookOptions,
  IIdeaStore,
  TIdeaOrigin,
  TIdeaStatus,
} from './ideas/ideas.js';
export { IDEA_INSTRUCTIONS, IDEA_TOOL_NAMES, createIdeaTools } from './ideas/tools.js';
export { createChannelHub, splitForChannel } from './channels/hub.js';
export type {
  IChannelBinding,
  IChannelHub,
  IChannelHubOptions,
  TChannelApprovalAnswer,
  TChannelTurn,
} from './channels/hub.js';
export { createFixtureChannel } from './channels/fixture.js';
export type { IFixtureChannel } from './channels/fixture.js';
export type {
  IChannelAdapter,
  IChannelApprovalAnswer,
  IChannelApprovalRequest,
  IChannelCapabilities,
  IChannelHandler,
  IChannelMessage,
} from './channels/types.js';
export {
  SpaceBook,
  SpaceRefusedError,
  createFileSpaceStore,
  createMemorySpaceStore,
} from './spaces/spaces.js';
export type { ISpace, ISpacePage, ISpaceStore } from './spaces/spaces.js';
export {
  ConnectorBook,
  ConnectorRefusedError,
  createFileConnectorStore,
  createMemoryConnectorStore,
} from './connectors/book.js';
export type { IConnectorStore, ICreateConnectorInput } from './connectors/book.js';
export {
  ATTENTION_MAX_CHARACTERS,
  defaultAttention,
  effectiveAttention,
} from './connectors/attention.js';
export { catalogEntriesFromRegistry, catalogEntryOf } from './connectors/catalog.js';
export type { IConnectorCatalogEntry } from './connectors/catalog.js';
export { ConnectorRegistry, classifyTool } from './connectors/registry.js';
export type {
  IConnectorRegistryOptions,
  IConnectorToolView,
  IConnectorView,
} from './connectors/registry.js';
export {
  CONNECTOR_INSTRUCTIONS,
  CONNECTOR_TOOL_NAMES,
  createConnectorTools,
} from './connectors/tools.js';
export {
  connectorReference,
  countPulled,
  createConnectorKeepTool,
  forgetPulled,
  originOfConnector,
} from './connectors/keep.js';
export {
  ConnectorSync,
  SYNC_MAX_MINUTES,
  SYNC_MIN_MINUTES,
  syncRunTools,
  syncGoalPrompt,
  syncRunInstructions,
} from './connectors/sync.js';
export type { IConnectorSyncStatus } from './connectors/sync.js';
export { CONNECTOR_AUTHS, CONNECTOR_KINDS } from './connectors/types.js';
export type {
  IConnector,
  IConnectorCallResult,
  IConnectorProtocol,
  IConnectorStatus,
  IConnectorToolHints,
  IConnectorToolInfo,
  IDisconnectOutcome,
  ISignInContext,
  TConnectorAuth,
  TConnectorKind,
  TConnectorState,
  TRevocation,
  TToolAccess,
  TToolDecision,
} from './connectors/types.js';
