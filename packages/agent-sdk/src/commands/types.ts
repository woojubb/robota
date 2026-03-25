/** A command entry */
export interface ICommand {
  /** Command name without slash (e.g., "mode") */
  name: string;
  /** Short description shown in autocomplete */
  description: string;
  /** Source identifier (e.g., "builtin", "skill") */
  source: string;
  /** Subcommands for hierarchical menus */
  subcommands?: ICommand[];
  /** Execute the command. Args is everything after the command name. */
  execute?: (args: string) => void | Promise<void>;
  /** Full SKILL.md content (only for skill commands) */
  skillContent?: string;
  /** Hint for the expected argument (Claude Code frontmatter) */
  argumentHint?: string;
  /** When true, models cannot invoke this skill autonomously */
  disableModelInvocation?: boolean;
  /** When false, users cannot invoke this skill directly */
  userInvocable?: boolean;
  /** List of tools this skill is allowed to use */
  allowedTools?: string[];
  /** Preferred model for executing this skill */
  model?: string;
  /** Effort level hint for the skill */
  effort?: string;
  /** Context scope for the skill (e.g., "project") */
  context?: string;
  /** Agent identity to use when executing this skill */
  agent?: string;
  /** Plugin installation directory (plugin skills/commands only) */
  pluginDir?: string;
}

/** A source that provides commands */
export interface ICommandSource {
  name: string;
  getCommands(): ICommand[];
}
