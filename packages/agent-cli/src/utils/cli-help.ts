/**
 * CLI usage help text.
 *
 * Split out of `cli-args.ts` (CLI-2004) by responsibility: that module parses and validates
 * arguments, this one is the user-facing catalogue of them. Keeping a ~65-line template literal
 * inside the parser is what made adding one flag a size-budget question instead of a one-line edit.
 * Re-exported from `cli-args.ts` so every existing import site keeps working unchanged.
 */

const USAGE = `
Usage: robota [options] [-p <prompt>]
`;

const OPTIONS = `  -p <prompt>                Run in print (headless) mode with the given prompt
  --output-format <format>   Output format: text | json | stream-json (default: text)
  --system-prompt <text>     Override the system prompt for this session
  --append-system-prompt <t> Append text to the system prompt
  --language <lang>          Language preference (e.g. ko, en)
  --no-session-persistence   Disable session persistence for this run
  --permission-mode <mode>   Permission mode: plan | default | acceptEdits | bypassPermissions
  --max-turns <n>            Maximum agent turns before stopping
  -c, --continue             Continue the most recent session
  -r, --resume <id>          Resume a session by ID or name
  -n, --name <name>          Name for the new session
  --fork-session             Fork the current session into a new independent session
  --task-file <path>         Read a task prompt from file and append it to the system prompt
  --bare                     Print mode: output raw text only, no formatting wrapper
  --configure                Run interactive provider configuration
  --configure-provider <n>   Configure a specific provider
  --allowed-tools <list>     Comma-separated tool allowlist (TUI and print mode)
  --denied-tools <list>      Comma-separated tool denylist (TUI and print mode)
  --model <model>            Model override for this run
  --preset <id>              Preset id to apply (default: settings.preset or "default")
  --memory / --no-memory     Enable/disable durable memory for this run (default: off; opt-in).
                             Overrides settings.json memory.enabled; ROBOTA_MEMORY=1|0 overrides both
  --memory-autosave          With memory on, auto-save captured facts (default: approval-required queue)
  --screen-reader            Plain-text screen-reader mode: no box-drawing chrome, no spinners,
                             role-labelled transcript, numbered menus, bell + OSC 133 turn marks.
                             Overrides ROBOTA_SCREEN_READER=1|0 and settings.json screenReader
  --no-screen-reader         Force screen-reader mode off for this run
  --json-schema <schema>     Print mode: instruct the model to respond with JSON matching this schema
  --dry-run                  Alias for --permission-mode plan (plan only, no execution)
  --reset                    Delete ~/.robota/settings.json (provider profiles and preferences).
                             Asks for confirmation; use --yes to skip
  --yes                      Skip confirmation prompts (required for --reset in non-TTY)
  --serve --open             Serve the web monitor over localhost and open it in a browser
  --check-update             Check for CLI updates
  --version                  Show version number
  -h, --help                 Show this help message

Commands:
  robota init                      Initialize AGENTS.md and .robota/settings.json
  robota diagnose                  Check setup and print a diagnostics report
  robota trust [status|grant|revoke] [--yes]
                                  Inspect or change the current workspace trust grant
  robota usage [options]           Show 7/30-day cross-session personal usage (text or JSON)
  robota eval <definition>         Run an evals-as-code definition; exit 1 on a metric breach (CI gate)

Examples:
  robota                           Start interactive TUI session
  robota init                      Initialize project files
  robota -p "Hello"                Print mode: send prompt and exit
  robota -p "Hello" --output-format json
  robota -p "Review this diff" --bare    Raw output for shell pipelines
  robota --task-file task.md       Run task from file (appended to system prompt)
  robota -p "Refactor the auth module" --dry-run   Plan only, no execution
  robota --continue                Resume the last session
`;

/** Return CLI usage help text. */
export function printHelp(): string {
  return `${USAGE}
Options:
${OPTIONS}`;
}
