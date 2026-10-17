/**
 * Korean memory cues for the documented default extractor and sensitive-term policies. The phrases
 * are locale data and live in `locales/ko.json`; this module only gives them a type.
 */
import cues from './locales/ko.json';

export interface IMemoryLocaleCues {
  /** Trigger patterns whose first capture group becomes the candidate text. */
  readonly triggers: readonly { readonly pattern: string; readonly confidence: 'high' | 'medium' }[];
  /** Words that classify a candidate as project-scoped memory. */
  readonly projectTerms: readonly string[];
  /** Words that classify a candidate as a user preference. */
  readonly preferenceTerms: readonly string[];
  /** Words that mark a candidate as sensitive, so it is never saved automatically. */
  readonly sensitiveTerms: readonly string[];
}

export const KOREAN_MEMORY_CUES: IMemoryLocaleCues = cues.ko as IMemoryLocaleCues;
