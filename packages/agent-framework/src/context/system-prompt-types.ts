export type TSystemPromptSectionSource =
  | 'framework'
  | 'persona'
  | 'preset-system-prompt'
  | 'self-verification'
  | 'project-instructions'
  | 'runtime'
  | 'permissions'
  | 'provider'
  | 'command'
  | 'skill'
  | 'tool'
  | 'agent';

export interface ISystemPromptSection {
  readonly id: string;
  readonly title?: string;
  readonly priority: number;
  readonly content: string;
  readonly source: TSystemPromptSectionSource;
}
