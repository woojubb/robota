import { createSystemMessage, createUserMessage } from '@robota-sdk/agent-core';

import type { IAIProvider } from '@robota-sdk/agent-core';

const SYSTEM_PROMPT =
  'You generate short session titles. Respond with ONLY a 3-5 word lowercase-hyphenated title (e.g. refactor-auth-middleware). No explanation, no punctuation, no quotes.';

const MAX_FIRST_MESSAGE_CHARS = 200;

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

export async function generateSessionName(
  provider: IAIProvider,
  firstMessage: string,
): Promise<string> {
  const truncated = firstMessage.slice(0, MAX_FIRST_MESSAGE_CHARS);
  const response = await provider.chat(
    [createSystemMessage(SYSTEM_PROMPT), createUserMessage(truncated)],
    { maxTokens: 20 },
  );
  const raw = typeof response.content === 'string' ? response.content : '';
  const name = sanitizeName(raw);
  if (!name || name.length < 3) return sanitizeName(firstMessage);
  return name;
}
