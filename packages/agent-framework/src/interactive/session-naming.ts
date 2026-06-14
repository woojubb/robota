/**
 * LLM-based session auto-naming. Owned by the framework (interactive-session lifecycle layer) so
 * the prompt/policy lives with session ownership, not in a transport. Transports invoke this and
 * apply the result via `IInteractiveSession.setName`.
 */

import { createSystemMessage, createUserMessage } from '@robota-sdk/agent-core';

import type { IAIProvider } from '@robota-sdk/agent-core';

const SYSTEM_PROMPT =
  'You generate short session titles. Respond with ONLY a 3-5 word lowercase-hyphenated title (e.g. refactor-auth-middleware). No explanation, no punctuation, no quotes.';

const MAX_FIRST_MESSAGE_CHARS = 200;
const MAX_TITLE_TOKENS = 20;
const MAX_NAME_CHARS = 60;
const MIN_NAME_CHARS = 3;

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
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
): Promise<string> {
  const truncated = firstMessage.slice(0, MAX_FIRST_MESSAGE_CHARS);
  const response = await provider.chat(
    [createSystemMessage(SYSTEM_PROMPT), createUserMessage(truncated)],
    { maxTokens: MAX_TITLE_TOKENS },
  );
  const raw = typeof response.content === 'string' ? response.content : '';
  const name = sanitizeName(raw);
  if (!name || name.length < MIN_NAME_CHARS) return sanitizeName(firstMessage);
  return name;
}
