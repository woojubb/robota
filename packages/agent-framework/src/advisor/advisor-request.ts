/**
 * The one request the advisor model receives: the main model's system prompt and conversation,
 * serialized into a single prompt.
 *
 * The conversation cannot be sent as messages: it ends in the main model's own unanswered Advisor
 * call, which no provider accepts as the last turn. It is rendered with the same serializer
 * compaction uses, so tool calls, tool results and who wrote each user message survive.
 */

import { CONTEXT_ESTIMATE_CHARS_PER_TOKEN } from '@robota-sdk/agent-core';
import { formatConversationEntries } from '@robota-sdk/agent-session';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

export const ADVISOR_SYSTEM_PROMPT = [
  'You advise another AI agent that is partway through a task for its user.',
  'You see its instructions and its conversation so far, including the tools it called and what they returned.',
  'Answer its question with concrete, brief guidance: what you would do next, what looks wrong, what it has not checked.',
  'You cannot run tools. Say what evidence would settle a point rather than guessing.',
  'Answer in plain text.',
].join('\n');

const DEFAULT_QUESTION =
  'Review the approach so far. What should change, what is missing, and is the work actually done?';

/** Output tokens kept free for the advisor's answer. */
export const ADVISOR_MAX_OUTPUT_TOKENS = 2_048;

export interface IAdvisorRequestInput {
  readonly systemPrompt: string;
  readonly history: readonly TUniversalMessage[];
  readonly question?: string;
  /** The advisor model's context window, in tokens. */
  readonly contextWindow: number;
}

export interface IAdvisorRequest {
  readonly prompt: string;
  /** How many of the oldest messages were left out to fit the window. */
  readonly omittedMessages: number;
}

function tokensOf(text: string): number {
  return Math.ceil(text.length / CONTEXT_ESTIMATE_CHARS_PER_TOKEN);
}

function assemble(
  systemPrompt: string,
  entries: readonly string[],
  omitted: number,
  question: string,
): string {
  return [
    "The agent's instructions (its system prompt):",
    '<<<INSTRUCTIONS',
    systemPrompt,
    'INSTRUCTIONS>>>',
    '',
    'The conversation so far, oldest first. The last entry is the agent calling you.',
    '<<<CONVERSATION',
    ...(omitted > 0 ? [`[${omitted} earlier messages omitted to fit the context window]`] : []),
    ...entries,
    'CONVERSATION>>>',
    '',
    `The agent asks: ${question}`,
  ].join('\n');
}

/**
 * Build the prompt, dropping the oldest messages until it fits the advisor's window. The system
 * prompt is never dropped; when it alone does not fit, there is no request (`undefined`).
 */
export function buildAdvisorRequest(input: IAdvisorRequestInput): IAdvisorRequest | undefined {
  const question = input.question?.trim() || DEFAULT_QUESTION;
  const budget = input.contextWindow - ADVISOR_MAX_OUTPUT_TOKENS - tokensOf(ADVISOR_SYSTEM_PROMPT);
  const entries = formatConversationEntries(input.history);
  const fixed = tokensOf(assemble(input.systemPrompt, [], entries.length, question));
  if (fixed > budget) return undefined;

  let remaining = budget - fixed;
  let start = entries.length;
  while (start > 0) {
    // +1 for the newline that joins the entry to the prompt.
    const cost = tokensOf(entries[start - 1]!) + 1;
    if (cost > remaining) break;
    remaining -= cost;
    start -= 1;
  }
  return {
    prompt: assemble(input.systemPrompt, entries.slice(start), start, question),
    omittedMessages: start,
  };
}
