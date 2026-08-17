/**
 * Assembly module — session factory and tool/provider creation.
 */

export { createSession } from './create-session.js';
export type { ICreateSessionOptions, ICreateSessionResult } from './create-session.js';
export { deriveContextCapacityHint } from './context-capacity-hint.js';
export { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from './create-tools.js';
// ARCH-037: `createDefaultTools` is published, so the type its caller must construct has to be
// nameable too — the `IScheduleEditPatch` / `ISubagentExecutionEnvelope` shape, found by the new
// `barrel-parameter-types` floor rather than by another reading.
export type { ICreateDefaultToolsOptions } from './create-tools.js';
export {
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
} from './subagent-prompts.js';
export type { ISubagentPromptOptions, TSubagentSuffix } from './subagent-prompts.js';
export { createSubagentSession } from './create-subagent-session.js';
export type { ISubagentOptions } from './create-subagent-session.js';
export { createSubagentLogger, resolveSubagentLogDir } from './subagent-logger.js';
