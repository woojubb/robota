// SELFHOST-003: codebase retrieval — port + types + neutral repo-map ranking adapter + tool.

export type {
  IRetrievalSymbol,
  IRetrievalParsedFile,
  IRetrievalSourceParser,
  IRetrievalCorpusFile,
  IRetrievalRequest,
  IRetrievalRankedSymbol,
  IRetrievalResult,
  IRetrievalAdapter,
  IRetrievalToolOptions,
  IRepoMapIndexEntry,
  IRepoMapIndex,
  IRepoMapIndexChanges,
} from './types.js';

export {
  buildRepoMapIndex,
  updateRepoMapIndex,
  serializeRepoMapIndex,
  deserializeRepoMapIndex,
  REPO_MAP_INDEX_VERSION,
  type IBuildRepoMapIndexOptions,
} from './repo-map-index.js';

export {
  RepoMapRetrievalAdapter,
  type IRepoMapRetrievalAdapterOptions,
} from './repo-map-adapter.js';

export { createRetrievalTool } from './retrieval-tool.js';
