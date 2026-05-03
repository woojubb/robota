import type { IContextWindowState } from '@robota-sdk/agent-core';
import type { ICommandHostContext } from '../host-context.js';

export type TAutoCompactThreshold = number | false;

export interface ICompactContextResult {
  before: IContextWindowState;
  after: IContextWindowState;
}

/** Read context-window state through the command host facade. */
export function readCommandContextState(context: ICommandHostContext): IContextWindowState {
  return context.getContextState();
}

/** Read the effective automatic compact policy through the command host facade. */
export function readAutoCompactThreshold(context: ICommandHostContext): TAutoCompactThreshold {
  return context.getAutoCompactThreshold();
}

/** Run manual compaction through the command host facade and return before/after state. */
export async function compactCommandContext(
  context: ICommandHostContext,
  instructions?: string,
): Promise<ICompactContextResult> {
  const before = readCommandContextState(context);
  await context.compactContext(instructions);
  const after = readCommandContextState(context);
  return { before, after };
}
