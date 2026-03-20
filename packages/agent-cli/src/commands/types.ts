/** A slash command entry */
export interface ISlashCommand {
  /** Command name without slash (e.g., "mode") */
  name: string;
  /** Short description shown in autocomplete */
  description: string;
  /** Source identifier (e.g., "builtin", "skill") */
  source: string;
  /** Subcommands for hierarchical menus */
  subcommands?: ISlashCommand[];
  /** Execute the command. Args is everything after the command name. */
  execute?: (args: string) => void | Promise<void>;
  /** Full SKILL.md content (only for skill commands) */
  skillContent?: string;
}

/** A source that provides slash commands */
export interface ICommandSource {
  name: string;
  getCommands(): ISlashCommand[];
}
