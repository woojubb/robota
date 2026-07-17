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
} from './types.js';

export {
  RepoMapRetrievalAdapter,
  type IRepoMapRetrievalAdapterOptions,
} from './repo-map-adapter.js';

export { createRetrievalTool } from './retrieval-tool.js';
