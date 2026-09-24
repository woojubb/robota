import type { IDagError } from './error.js';
import type { TResult } from './result.js';

/** Plain operation data. No executable source or live execution capabilities cross the boundary. */
export interface IRegexReplaceRequest {
  text: string;
  search: string;
  replacement: string;
  flags: string;
}
/** Trusted host capability for the built-in regex operation. */
export interface IRegexReplaceOperation {
  execute(request: IRegexReplaceRequest, signal?: AbortSignal): Promise<TResult<string, IDagError>>;
}
