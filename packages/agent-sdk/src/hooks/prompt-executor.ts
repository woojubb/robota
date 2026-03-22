/**
 * Prompt hook executor — evaluates a prompt via an AI model.
 *
 * Makes a single-turn LLM call with hook input context as the prompt.
 * Parses { ok: boolean, reason?: string } from the AI response.
 *
 * Exit codes:
 * - 0: ok: true (allow/proceed)
 * - 2: ok: false (block/deny), reason in stderr
 * - 1: execution error (provider failure, parse error)
 */

import type {
  IPromptHookDefinition,
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
  IHookDefinition,
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

  async execute(definition: IHookDefinition, input: IHookInput): Promise<IHookResult> {
    const promptDef = definition as IPromptHookDefinition;
    const model = promptDef.model ?? this.defaultModel;

    try {
      const provider = this.providerFactory(model);
      const prompt = `${promptDef.prompt}\n\nContext:\n${JSON.stringify(input)}\n\nRespond with JSON: { "ok": boolean, "reason"?: string }`;
      const rawResponse = await provider.complete(prompt);
      const jsonStr = extractJson(rawResponse);

      let parsed: { ok: boolean; reason?: string };
      try {
        parsed = JSON.parse(jsonStr) as { ok: boolean; reason?: string };
      } catch {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Failed to parse AI response as JSON: ${rawResponse}`,
        };
      }

      if (parsed.ok) {
        return { exitCode: 0, stdout: JSON.stringify(parsed), stderr: '' };
      }

      return {
        exitCode: 2,
        stdout: '',
        stderr: parsed.reason ?? 'Blocked by prompt hook',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: message };
    }
  }
}
