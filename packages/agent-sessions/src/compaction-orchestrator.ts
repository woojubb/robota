/**
 * CompactionOrchestrator — handles conversation compaction (summarization)
 * to free context window space.
 *
 * Extracted from Session to separate compaction logic from conversation management.
 */

import { runHooks } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  TUniversalMessage,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';

export interface ICompactionOptions {
  sessionId: string;
  cwd: string;
  model: string;
  hooks?: Record<string, unknown>;
  compactInstructions?: string;
  /** Additional hook type executors (e.g. prompt, agent) beyond the core defaults. */
  hookTypeExecutors?: IHookTypeExecutor[];
}

export class CompactionOrchestrator {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly model: string;
  private readonly hooks?: Record<string, unknown>;
  private readonly compactInstructions?: string;
  private readonly hookTypeExecutors?: IHookTypeExecutor[];

  constructor(options: ICompactionOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.model = options.model;
    this.hooks = options.hooks;
    this.compactInstructions = options.compactInstructions;
    this.hookTypeExecutors = options.hookTypeExecutors;
  }

  /**
   * Run compaction — summarize the conversation to free context space.
   * @param provider - The AI provider to use for summarization
   * @param history - Current conversation history
   * @param instructions - Optional focus instructions for the summary
   * @returns The generated summary string
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
      [{ role: 'user', content: compactPrompt, timestamp: new Date() }],
      { model: this.model },
    );
    const summary =
      typeof summaryMessage.content === 'string' ? summaryMessage.content : '(compaction failed)';

    return summary;
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
      'Summarize the following conversation concisely, preserving:',
      "- User's original requests and goals",
      '- Key decisions and conclusions',
      '- Important code changes and file paths',
      '- Current task status and next steps',
      instructionSection,
      "Drop verbose tool outputs, debugging steps, and exploratory work that didn't lead to results.",
      '',
      'Conversation:',
      formattedHistory,
    ].join('\n');
  }
}
