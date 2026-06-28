import type { IActionRequest, IUserInteraction, TActionResponse } from '@robota-sdk/agent-core';
import type { ICommandHostContext } from '@robota-sdk/agent-framework';

/**
 * Build a command host context whose `getUserInteraction().ask` replays a scripted sequence of
 * responses (CMD-004 test double). Each `ask` records the request it received (so tests can assert on
 * the rendered action shape) and returns the next scripted answer; once the script is exhausted it
 * returns `{ type: 'cancelled' }`, mirroring a user dismissing the prompt.
 */
export function scriptedContext(answers: readonly TActionResponse[]): {
  context: ICommandHostContext;
  requests: IActionRequest[];
} {
  const requests: IActionRequest[] = [];
  let index = 0;
  const ui: IUserInteraction = {
    ask: (request) => {
      requests.push(request);
      const answer = answers[index];
      index += 1;
      return Promise.resolve(answer ?? { type: 'cancelled' });
    },
  };
  const context = {
    getUserInteraction: () => ui,
  } as Partial<ICommandHostContext> as ICommandHostContext;
  return { context, requests };
}
