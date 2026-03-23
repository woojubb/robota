/**
 * Assembly module — session factory and tool/provider creation.
 */

export { createSession } from './create-session.js';
export type { ICreateSessionOptions } from './create-session.js';
export { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from './create-tools.js';
export { createProvider } from './create-provider.js';
export {
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
} from './subagent-prompts.js';
export type { ISubagentPromptOptions } from './subagent-prompts.js';
export { createSubagentSession } from './create-subagent-session.js';
export type { ISubagentOptions } from './create-subagent-session.js';
