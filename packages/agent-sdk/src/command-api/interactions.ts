import type { ICommandResult } from './command-result.js';

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

/** Stateful command continuation owned by the command module. */
export interface ICommandInteraction {
  prompt: TCommandInteractionPrompt;
  submit(value: string): Promise<ICommandResult> | ICommandResult;
  cancel?(): Promise<ICommandResult> | ICommandResult;
}
