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
