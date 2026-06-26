import type { ISystemCommand } from './contracts.js';
import type { ICommandSource } from './types.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { TCommandInteractionHint } from '../interaction/types.js';

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
  /** Runtime facilities required by this module. */
  readonly sessionRequirements?: readonly TCommandModuleSessionRequirement[];
  /** Interaction hints consumed by createInteractiveRuntime for disambiguation dialogs. */
  readonly interactionHints?: Record<string, TCommandInteractionHint>;
}
