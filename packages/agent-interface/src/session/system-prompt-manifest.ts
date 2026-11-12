/**
 * What a session's system prompt was composed of, without the text itself.
 *
 * The prompt text is stored whole beside it, but its sections cannot be recovered from that text:
 * project instructions carry their own headings, and some sections have none. The manifest is the
 * only record of where one section ends and the next begins, and which of them the product's own
 * harness contributed.
 */

/** One composed section as the model received it. */
export interface ISystemPromptManifestSection {
  /** Stable section id, e.g. `project-agents-md` or `preset-persona`. */
  readonly id: string;
  /** Where the section came from, e.g. `persona`, `runtime`, `tool`. */
  readonly source: string;
  /** Length of the section exactly as rendered into the prompt (title line included). */
  readonly characters: number;
}

export interface ISystemPromptManifest {
  /**
   * Identifies the harness text this prompt carried: a digest of the sections the product's harness
   * owns, or `none` when it contributed no section. Two prompts with the same value carried the same
   * harness text, whatever else (project files, tool lists) differed.
   */
  readonly harnessVersion: string;
  /** Sections in the order they appear in the prompt. */
  readonly sections: readonly ISystemPromptManifestSection[];
}
