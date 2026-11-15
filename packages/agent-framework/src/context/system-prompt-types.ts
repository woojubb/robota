import type { ISystemPromptManifest } from '@robota-sdk/agent-interface/session';

export type TSystemPromptSectionSource =
  | 'framework'
  | 'output-style'
  | 'persona'
  | 'preset-system-prompt'
  | 'product'
  | 'self-verification'
  | 'project-instructions'
  | 'runtime'
  | 'permissions'
  | 'provider'
  | 'command'
  | 'skill'
  | 'tool'
  | 'agent';

/** A titled-or-untitled section a product contributes to the prompt it composes. */
export interface IProductPromptSection {
  /** Stable, caller-owned and unique within the list; it is the section's id in the manifest. */
  readonly id: string;
  /** Rendered as a heading only when given, exactly like the other titled sections. */
  readonly title?: string;
  readonly content: string;
}

export interface ISystemPromptSection {
  readonly id: string;
  readonly title?: string;
  readonly priority: number;
  readonly content: string;
  readonly source: TSystemPromptSectionSource;
}

/**
 * The sources whose text is the product's own harness guidance. They are what `harnessVersion`
 * identifies; every other source is the user's project, the environment or the tool inventory.
 */
export const HARNESS_SECTION_SOURCES: readonly TSystemPromptSectionSource[] = [
  'preset-system-prompt',
  'product',
  'persona',
  'self-verification',
];

/**
 * A composed system message together with what it was composed from. `manifest` is absent when the
 * message came from a caller-supplied builder, which returns text only.
 */
export interface IComposedSystemPrompt {
  readonly message: string;
  readonly manifest: ISystemPromptManifest | undefined;
}
