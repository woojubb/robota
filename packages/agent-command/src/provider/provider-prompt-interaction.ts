import type { IUserInteraction } from '@robota-sdk/agent-core';
import type { TPromptInput } from './provider-setup-flow.js';

/** Adapt existing terminal key/model prompts; browser waiting uses the host's abortable interaction. */
export function createProviderPromptInteraction(promptInput: TPromptInput): IUserInteraction {
  return {
    async ask(request, options) {
      const choices = request.options ?? [];
      const labels = [
        request.description,
        `  ${request.title}`,
        ...choices.map((choice, index) => `    ${index + 1}. ${choice.label}`),
        choices.length > 0 ? '  Choose: ' : `  ${request.placeholder ?? ''}: `,
      ]
        .filter((value) => value !== undefined)
        .join('\n');
      const answer = await promptInput(labels, request.masked, options);
      if (options?.signal?.aborted) return { type: 'cancelled' };
      if (choices.length === 0) return { type: 'answer', values: [], text: answer };
      const selected =
        choices[Number(answer.trim() || '1') - 1] ??
        choices.find((choice) => choice.value === answer.trim());
      return selected === undefined
        ? { type: 'cancelled' }
        : { type: 'answer', values: [selected.value] };
    },
  };
}
