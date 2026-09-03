/**
 * Assembly module — session factory and tool/provider creation.
 */

export { createSession } from './create-session.js';
export type { ICreateSessionOptions, ICreateSessionResult } from './create-session.js';
// Issue #2056: the session-level structured-output shape, named where it is declared.
export type { TSessionResponseFormat } from './create-session-types.js';
export { deriveContextCapacityHint } from './context-capacity-hint.js';
// ARCH-037: `createDefaultTools` is published, so the type its caller must construct has to be
// nameable too — the `IScheduleEditPatch` / `ISubagentExecutionEnvelope` shape, found by the new
// `barrel-parameter-types` floor rather than by another reading.
export {
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
} from './subagent-prompts.js';
export type { ISubagentPromptOptions, TSubagentSuffix } from './subagent-prompts.js';
export { createSubagentSession } from './create-subagent-session.js';
export type { ISubagentOptions, ISubagentParentContext } from './create-subagent-session.js';
export { createSubagentLogger, resolveSubagentLogDir } from './subagent-logger.js';
