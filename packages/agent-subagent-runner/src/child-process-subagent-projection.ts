/**
 * What the PARENT projects onto a child-process subagent's start payload.
 *
 * A child rebuilds its own tool surface in another process, so anything the parent's SESSION decided
 * — which assembly tiers it carried, which sandbox it holds — has to travel as data. This module is
 * the producer half of that contract; `worker-composition.ts` is the consumer half.
 *
 * It exists as its own file because review of ARCH-033/ARCH-034 found both fields declared on the
 * wire type and read by the worker while NOTHING wrote them. Keeping the producer beside the
 * consumer's vocabulary, rather than inside a runner that is mostly about process lifecycle, is what
 * makes "who writes this field" answerable by looking.
 */

import type { ISandboxProjection } from './worker-composition.js';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

/** The parent-decided fields of a start payload, ready to spread onto it. */
export interface IProjectedParentState {
  sessionTiers?: IInProcessSubagentRunnerDeps['sessionTiers'];
  sandboxProjection?: ISandboxProjection;
}

/**
 * ARCH-034: the parent's assembly tiers, verbatim.
 *
 * `{ includeGoalTool: false }` and "the parent said nothing" are DIFFERENT states and are kept
 * apart: folding them together would make the tier unreadable in exactly the case a product turns it
 * off deliberately.
 */
export function projectSessionTiers(
  deps: Pick<IInProcessSubagentRunnerDeps, 'sessionTiers'>,
): Pick<IProjectedParentState, 'sessionTiers'> {
  return deps.sessionTiers === undefined ? {} : { sessionTiers: deps.sessionTiers };
}

/**
 * ARCH-033: `(type, snapshotId)` for the parent's sandbox, or nothing.
 *
 * BOTH halves are required to produce either. A snapshot with no registered type is a reference
 * nothing on the worker side opens; a type with no snapshot rebuilds an EMPTY sandbox, which is a
 * child that looks sandboxed while sharing none of the parent's state. Silence here is the honest
 * answer for a half-configured composition — `assertChildProcessSubagentsCanReproduce` is what
 * REFUSES it, at the composition root, where it can name the missing piece.
 *
 * A `snapshot()` that throws propagates: the alternative is a child that starts with no sandbox
 * after its parent was asked for one, which is the silent half-capability this exists to prevent.
 */
export async function projectSandbox(
  deps: Pick<IInProcessSubagentRunnerDeps, 'sandboxClient' | 'sandboxType'>,
): Promise<Pick<IProjectedParentState, 'sandboxProjection'>> {
  const { sandboxClient, sandboxType } = deps;
  if (sandboxClient?.snapshot === undefined || sandboxType === undefined) return {};
  return { sandboxProjection: { type: sandboxType, snapshotId: await sandboxClient.snapshot() } };
}
