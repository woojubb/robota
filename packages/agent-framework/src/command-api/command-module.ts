import type { ISystemCommand } from './contracts.js';
import type { ICommandSource } from './types.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';

/**
 * CMD-008: a session requirement is a DEMAND SWITCH, not a registration gate. Declaring one does
 * not gate the module on runtime capability being available; it makes the session projection
 * enable that facility (`'agent-runtime'` → `enableAgentRuntime: true`) so the module's commands
 * can rely on it. Pinned by `interactive/__tests__/command-module-session-requirements.test.ts`.
 */
export type TCommandModuleSessionRequirement = 'agent-runtime';

/** Composable command capability module. */
export interface ICommandModule {
  /** Stable module id for diagnostics and duplicate handling. */
  readonly name: string;
  /** Slash palette/autocomplete command sources contributed by this module. */
  readonly commandSources?: readonly ICommandSource[];
  /** Executable system commands contributed by this module. */
  readonly systemCommands?: readonly ISystemCommand[];
  /** Additional model-visible descriptors not derived from executable commands. */
  readonly commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Runtime facilities this module DEMANDS — the session enables each one when the module is composed. */
  readonly sessionRequirements?: readonly TCommandModuleSessionRequirement[];
}
