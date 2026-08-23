/**
 * Prompt hook executor — evaluates a prompt via an AI model.
 *
 * Makes a single-turn LLM call with hook input context as the prompt.
 * Parses { ok: boolean, reason?: string } from the AI response.
 *
 * Outcomes (SEC-015): `ok: true` → `allow`; `ok: false` → `deny` with its reason; a non-boolean
 * or missing `ok`, or an unparseable response → `error`/`malformed-response`; a provider or
 * session failure → `error`/`transport-failure`. The three used to share exit code 1.
 */

import { decodeHookVerdict } from '@robota-sdk/agent-core';

import type {
  IPromptHookDefinition,
  IHookInput,
  THookOutcome,
  IHookTypeExecutor,
  THookDefinition,
} from '@robota-sdk/agent-core';

/** A minimal provider interface for single-turn completion. */
export interface IPromptProvider {
  complete(prompt: string): Promise<string>;
}

/** Factory that creates a provider instance, optionally for a specific model. */
export type TProviderFactory = (model?: string) => IPromptProvider;

/** Constructor options for PromptExecutor. */
export interface IPromptExecutorOptions {
  providerFactory: TProviderFactory;
  defaultModel?: string;
}

/** Extract JSON from a string, handling markdown code blocks. */
function extractJson(raw: string): string {
  const codeBlockMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(raw);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return raw.trim();
}

export class PromptExecutor implements IHookTypeExecutor {
  readonly type = 'prompt' as const;

  private readonly providerFactory: TProviderFactory;
  private readonly defaultModel: string | undefined;

  constructor(options: IPromptExecutorOptions) {
    this.providerFactory = options.providerFactory;
    this.defaultModel = options.defaultModel;
  }

  async execute(definition: THookDefinition, input: IHookInput): Promise<THookOutcome> {
    const promptDef = definition as IPromptHookDefinition;
    const model = promptDef.model ?? this.defaultModel;

    try {
      const provider = this.providerFactory(model);
      const prompt = `${promptDef.prompt}\n\nContext:\n${JSON.stringify(input)}\n\nRespond with JSON: { "ok": boolean, "reason"?: string }`;
      const rawResponse = await provider.complete(prompt);
      const jsonStr = extractJson(rawResponse);

      return decodeHookVerdict(jsonStr, 'prompt');
    } catch (err: unknown) {
      return {
        outcome: 'error',
        source: 'prompt',
        kind: 'transport-failure',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
