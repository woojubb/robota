import type { IHistoryEntry, IPromptRequest } from '@robota-sdk/dag-core';

export function recordPromptHistory(
  history: Map<string, IHistoryEntry>,
  promptId: string,
  prompt: IPromptRequest['prompt'],
  statusStr: 'success' | 'error',
): void {
  history.set(promptId, {
    prompt,
    outputs: {},
    status: {
      status_str: statusStr,
      completed: true,
      messages: [],
    },
  });
}
