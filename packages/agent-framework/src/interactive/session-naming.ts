/**
 * LLM-based session auto-naming. Owned by the framework (interactive-session lifecycle layer) so
 * the prompt/policy lives with session ownership, not in a transport. Transports invoke this and
 * apply the result via `IInteractiveSession.setName`.
 */

import { createSystemMessage, createUserMessage } from '@robota-sdk/agent-core';

import type { IAIProvider } from '@robota-sdk/agent-core';

const DEFAULT_NAMING_SYSTEM_PROMPT =
  'You generate short session titles. Respond with ONLY a 3-5 word hyphenated title in the language of the message (e.g. refactor-auth-middleware). No explanation, no punctuation, no quotes.';

const MAX_FIRST_MESSAGE_CHARS = 200;
const MAX_TITLE_TOKENS = 20;
const MAX_NAME_CHARS = 60;
const MIN_NAME_CHARS = 3;

/** Optional seams for session auto-naming (NEUT-005): prompt and sanitizer injection. */
export interface IGenerateSessionNameOptions {
  /** Replaces the default naming system prompt. */
  systemPrompt?: string;
  /** Replaces the default Unicode-aware sanitizer. */
  sanitize?: (raw: string) => string;
}

/**
 * Default Unicode-aware sanitizer: keeps letters and digits of ANY script (Korean, CJK, etc.),
 * lowercases where the script has case, and hyphenates whitespace. Only punctuation/symbols are
 * stripped — non-Latin titles survive intact.
 */
function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, MAX_NAME_CHARS);
}

/**
 * Generate a short session title from the first user message using the active provider.
 * Falls back to a sanitized form of the message when the model returns nothing usable.
 */
export async function generateSessionName(
  provider: IAIProvider,
  firstMessage: string,
  options: IGenerateSessionNameOptions = {},
): Promise<string> {
  const sanitize = options.sanitize ?? sanitizeName;
  const truncated = firstMessage.slice(0, MAX_FIRST_MESSAGE_CHARS);
  const response = await provider.chat(
    [
      createSystemMessage(options.systemPrompt ?? DEFAULT_NAMING_SYSTEM_PROMPT),
      createUserMessage(truncated),
    ],
    { maxTokens: MAX_TITLE_TOKENS },
  );
  const raw = typeof response.content === 'string' ? response.content : '';
  const name = sanitize(raw);
  if (!name || name.length < MIN_NAME_CHARS) return sanitize(firstMessage);
  return name;
}
