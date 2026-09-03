/**
 * Issue #2317 — what the parent's loaded context contributes to the child's wire payload.
 *
 * Beside `parent-config-projection.ts` for the same reason it exists: "which context members cross
 * a process boundary" is a different question from "how a child process is run".
 */

import type {
  IInProcessSubagentRunnerDeps,
  ISubagentParentContext,
} from '@robota-sdk/agent-framework';

/**
 * Issue #2317: the context members the CHILD reads, and no others.
 *
 * `parentContext` was the parent's whole `ILoadedContext`. Measured: the child reads `agentsMd` and
 * `projectNotesMd` (create-subagent-session.ts) and nothing else — no spread, `Object.keys` or
 * whole-object pass reaches the rest. The rest includes `agentsFileEntries` and
 * `projectNotesFileEntries`, each entry carrying the full `content` of a file the parent loaded, so
 * every AGENTS.md and CLAUDE.md was structurally cloned into every child process and read by nothing.
 *
 * Built key by key: structural typing would accept the whole context where the narrow type is
 * expected, so the type documents the intent and this function is what enforces it.
 */
export function projectParentContext(
  context: IInProcessSubagentRunnerDeps['context'],
): ISubagentParentContext {
  return {
    agentsMd: context.agentsMd,
    projectNotesMd: context.projectNotesMd,
  };
}
