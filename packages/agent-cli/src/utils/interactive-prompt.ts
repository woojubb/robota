export interface IChoicePromptOption {
  value: string;
  label: string;
}

export type TInteractivePrompt =
  | {
      kind: 'choice';
      title: string;
      options: readonly IChoicePromptOption[];
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
