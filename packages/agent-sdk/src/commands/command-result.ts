import type { TSessionEndReason, TUniversalValue } from '@robota-sdk/agent-core';

export type TCommandResultDataValue = TUniversalValue | object | readonly object[];

/** Choice option for command-owned follow-up prompts. */
export interface ICommandChoicePromptOption {
  value: string;
  label: string;
}

/** Generic prompt descriptor rendered by host UIs for command interactions. */
export type TCommandInteractionPrompt =
  | {
      kind: 'choice';
      title: string;
      options: readonly ICommandChoicePromptOption[];
      maxVisible?: number;
    }
  | {
      kind: 'text';
      title: string;
      placeholder?: string;
      allowEmpty?: boolean;
      masked?: boolean;
      validate?: (value: string) => string | undefined;
    };

export type TCommandEffect =
  | { type: 'model-change-requested'; modelId: string }
  | { type: 'language-change-requested'; language: string }
  | { type: 'settings-reset-requested' }
  | { type: 'session-exit-requested'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart-requested'; reason: TSessionEndReason; message: string }
  | { type: 'plugin-tui-requested' }
  | { type: 'session-picker-requested' }
  | { type: 'session-renamed'; name: string }
  | { type: 'statusline-settings-patch'; patch: Record<string, TUniversalValue> };

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

/** Stateful command continuation owned by the command module. */
export interface ICommandInteraction {
  prompt: TCommandInteractionPrompt;
  submit(value: string): Promise<ICommandResult> | ICommandResult;
  cancel?(): Promise<ICommandResult> | ICommandResult;
}
