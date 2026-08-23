// Hooks module
export { runHooks } from './hook-runner.js';
export type { IRunHooksResult } from './hook-runner.js';
// `CommandExecutor`/`HttpExecutor` are NOT here: they import `node:child_process`, and this barrel
// feeds the BROWSER build (CORE-028). They are exported from `@robota-sdk/agent-core/node`.
export { GuardrailExecutor } from './executors/guardrail-executor.js';
export { decodeHookVerdict } from './verdict-decoder.js';
export type {
  THookEvent,
  TSessionEndReason,
  THooksConfig,
  IHookGroup,
  ICommandHookDefinition,
  IHttpHookDefinition,
  IPromptHookDefinition,
  IAgentHookDefinition,
  IGuardrailHookDefinition,
  THookDefinition,
  IGuardrailResult,
  TGuardrail,
  IHookInput,
  THookErrorKind,
  IHookAllowOutcome,
  IHookDenyOutcome,
  IHookErrorOutcome,
  THookOutcome,
  IHookTypeExecutor,
} from './types.js';
