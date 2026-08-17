/**
 * CompactionOrchestrator — handles conversation compaction (summarization)
 * to free context window space.
 *
 * Extracted from Session to separate compaction logic from conversation management.
 */

import { randomUUID } from 'node:crypto';

import { runHooks } from '@robota-sdk/agent-core';

import type { TCompactTrigger } from './session-types.js';
import type {
  IAIProvider,
  TUniversalMessage,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';

/**
 * Thrown when a compaction summary is invalid (non-string or empty provider content).
 * Conversation history is append-only source data — callers must not clear or replace
 * it when this is thrown (see SPEC § Compaction Failure Contract).
 */
export class CompactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompactionError';
  }
}

/**
 * Default base template for the compaction summarization prompt — the one model-facing
 * prompt surface this package owns (declared in SPEC § Boundaries). Intentionally
 * domain-neutral: it must not assume a software-development conversation. Replaceable
 * wholesale via {@link ICompactionOptions.basePrompt}.
 */
export const DEFAULT_COMPACTION_PROMPT = [
  'Summarize the following conversation concisely, preserving:',
  "- User's original requests and goals",
  '- Key decisions, conclusions, and important state',
  '- Identifiers, names, and references needed to continue the work',
  '- Current task status and next steps',
  "Drop verbose intermediate outputs and exploratory work that didn't lead to results.",
].join('\n');

export interface ICompactionOptions {
  sessionId: string;
  cwd: string;
  model: string;
  hooks?: Record<string, unknown>;
  compactInstructions?: string;
  /**
   * Replaces the entire base instruction template of the compaction prompt
   * (default: {@link DEFAULT_COMPACTION_PROMPT}). Focus instructions and the
   * formatted conversation are appended after it.
   */
  basePrompt?: string;
  /** Additional hook type executors (e.g. prompt, agent) beyond the core defaults. */
  hookTypeExecutors?: IHookTypeExecutor[];
}

export class CompactionOrchestrator {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly model: string;
  private readonly hooks?: Record<string, unknown>;
  private readonly compactInstructions?: string;
  private readonly basePrompt?: string;
  private readonly hookTypeExecutors?: IHookTypeExecutor[];

  constructor(options: ICompactionOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.model = options.model;
    this.hooks = options.hooks;
    this.compactInstructions = options.compactInstructions;
    this.basePrompt = options.basePrompt;
    this.hookTypeExecutors = options.hookTypeExecutors;
  }

  /**
   * Run compaction — summarize the conversation to free context space.
   * @param provider - The AI provider to use for summarization
   * @param history - The messages to summarise. Must not be empty: whether there is anything worth
   *   compacting is the caller's judgement, made before it commits to replacing the conversation
   *   (CORE-031).
   * @param instructions - Optional focus instructions for the summary
   * @param signal - The turn's cancellation signal (RUNTIME-004). Checked before the provider call
   *   and again after it: an abort throws rather than returning, so the caller's existing
   *   leave-history-untouched path covers a cancel as well as a failure.
   * @returns The generated summary string (always a non-empty string)
   * @throws {CompactionError} when `history` is empty, or when the provider returns a non-string or
   *   empty summary — callers must leave the conversation history untouched in every such case
   */
  async compact(
    provider: IAIProvider,
    history: TUniversalMessage[],
    instructions?: string,
    signal?: AbortSignal,
    trigger: TCompactTrigger = 'manual',
  ): Promise<string> {
    // RUNTIME-004: FIRST, before the emptiness check. Review found that ordering the other way
    // returned a summary for an already-cancelled turn — and the caller replaces the conversation
    // with whatever this returns, so a cancel could still clear it and inject an empty summary.
    signal?.throwIfAborted();
    // CORE-031: this used to `return ''`, contradicting the contract two lines of docblock above it
    // ("always a non-empty string") — and the caller wrote that empty string over the conversation as
    // a summary. Deciding that an empty conversation is a no-op is the CALLER's judgement, made
    // before it commits to replacing anything; by the time execution is here, the caller has already
    // decided there is something to summarise, so an empty history means that decision was wrong.
    if (history.length === 0) {
      throw new CompactionError(
        'Compaction was asked to summarise an empty history; conversation history preserved untouched',
      );
    }

    // Fire PreCompact hook
    const preHookInput: IHookInput = {
      session_id: this.sessionId,
      cwd: this.cwd,
      hook_event_name: 'PreCompact',
      trigger,
    };
    await runHooks(
      this.hooks as THooksConfig | undefined,
      'PreCompact',
      preHookInput,
      this.hookTypeExecutors,
    );

    // Build compaction prompt
    const compactPrompt = this.buildCompactionPrompt(history, instructions);

    // Call provider to generate summary
    const summaryMessage = await provider.chat(
      [
        {
          id: randomUUID(),
          role: 'user',
          content: compactPrompt,
          state: 'complete' as const,
          timestamp: new Date(),
        },
      ],
      { model: this.model, ...(signal !== undefined ? { signal } : {}) },
    );
    // RUNTIME-004: the caller REPLACES the whole conversation with what this returns, so returning a
    // summary after a cancel is what destroyed it. Throwing puts an abort on the same path CORE-019
    // already built for an invalid summary — history left untouched.
    signal?.throwIfAborted();
    if (typeof summaryMessage.content !== 'string' || summaryMessage.content.trim() === '') {
      throw new CompactionError(
        `Compaction produced an invalid summary (provider=${provider.name}, content type=${typeof summaryMessage.content}); conversation history preserved untouched`,
      );
    }

    return summaryMessage.content;
  }

  /** Build the compaction prompt from conversation history */
  private buildCompactionPrompt(history: TUniversalMessage[], instructions?: string): string {
    const instructionBlock = instructions ?? this.compactInstructions ?? '';
    const instructionSection = instructionBlock ? `\nAdditional focus:\n${instructionBlock}\n` : '';

    const formattedHistory = history
      .map((msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return `${msg.role}: ${content}`;
      })
      .join('\n');

    return [
      this.basePrompt ?? DEFAULT_COMPACTION_PROMPT,
      instructionSection,
      '',
      'Conversation:',
      formattedHistory,
    ].join('\n');
  }
}
