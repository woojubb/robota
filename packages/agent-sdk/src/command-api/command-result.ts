import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { TCommandEffect } from './effects.js';
import type { ICommandInteraction } from './interactions.js';

export type TCommandResultDataValue = TUniversalValue | object | readonly object[];

/** Result of a system command execution. */
export interface ICommandResult {
  /** Human-readable output message */
  message: string;
  /** Command completed successfully */
  success: boolean;
  /** Additional structured data (command-specific diagnostics only) */
  data?: Record<string, TCommandResultDataValue>;
  /** Typed host effects requested by the command */
  effects?: readonly TCommandEffect[];
  /** Command-owned follow-up prompt and continuation */
  interaction?: ICommandInteraction;
}
