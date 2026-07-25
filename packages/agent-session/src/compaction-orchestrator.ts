/**
 * CompactionOrchestrator — handles conversation compaction (summarization)
 * to free context window space.
 *
 * Extracted from Session to separate compaction logic from conversation management.
 */

import { randomUUID } from 'node:crypto';

import { runHooks } from '@robota-sdk/agent-core';

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
   * @param history - Current conversation history
   * @param instructions - Optional focus instructions for the summary
   * @returns The generated summary string (always a non-empty string)
   * @throws {CompactionError} when the provider returns a non-string or empty summary —
   *   callers must leave the conversation history untouched in that case
   */
  async compact(
    provider: IAIProvider,
    history: TUniversalMessage[],
    instructions?: string,
  ): Promise<string> {
    if (history.length === 0) return '';

    const trigger: 'auto' | 'manual' = instructions !== undefined ? 'manual' : 'auto';

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
      { model: this.model },
    );
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
