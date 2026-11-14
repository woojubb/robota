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
  IGoal,
  IGoalAction,
  IGoalRun,
  IGoalStore,
  TApprovalState,
  TFeedKind,
  TGoalRunOutcome,
  TGoalStatus,
} from './goals/types.js';
