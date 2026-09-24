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
  --external-event-allow <server:sender>
                             TUI only: allow text-only turns via a trusted MCP server
                             that verifies the sender;
                             repeat per sender (off by default; no tools or automatic reply)
  --max-turns <n>            Maximum agent turns before stopping
  -c, --continue             Continue the most recent session
  -r, --resume <id>          Resume a session by ID or name
  -n, --name <name>          Name for the new session
  --fork-session             Fork the current session into a new independent session
  --task-file <path>         Read a task prompt from file and append it to the system prompt
  --bare                     Print mode: output raw text only, no formatting wrapper
  --configure                Run interactive provider configuration
  --configure-provider <n>   Configure a specific provider
  --allowed-tools <list>     Comma-separated tool auto-approval list
  --denied-tools <list>      Comma-separated tool denylist
  --model <model>            Model override for this run
  --effort <level>           Model effort: auto | low | medium | high | xhigh | max
  --preset <id>              Preset id to apply (default: settings.preset or "default")
  --output-style <id>        Response style: default | concise | proactive | explanatory | learning
  --memory / --no-memory     Enable/disable durable memory for this run (default: off; opt-in).
                             Overrides settings.json memory.enabled; ROBOTA_MEMORY=1|0 overrides both
  --memory-autosave          With memory on, auto-save captured facts (default: approval-required queue)
  --screen-reader            Plain-text screen-reader mode: no box-drawing chrome, no spinners,
                             role-labelled transcript, numbered menus, bell + OSC 133 turn marks.
                             Overrides ROBOTA_SCREEN_READER=1|0 and settings.json screenReader
                             Pacing: ROBOTA_SCREEN_READER_STARTUP_QUIET_MS (default 900) and
                             ROBOTA_SCREEN_READER_PREPARK_MS (default 50, 0 disables) in milliseconds
  --no-screen-reader         Force screen-reader mode off for this run
  --reduced-motion           Suppress animation for this run; colour is unaffected.
                             Overrides ROBOTA_REDUCED_MOTION=1|0 and settings.json reducedMotion
  --no-reduced-motion        Allow animation for this run, overriding a persisted reducedMotion
  --json-schema <schema>     Print mode: instruct the model to respond with JSON matching this schema
  --dry-run                  Alias for --permission-mode plan (plan only, no execution)
  --reset                    Delete ~/.robota/settings.json (provider profiles and preferences).
                             Asks for confirmation; use --yes to skip
  --yes                      Skip confirmation prompts (required for --reset in non-TTY)
  --serve --open             Serve the web monitor over localhost and open it in a browser
  --http-token-file <path>   With mcp serve, bind authenticated loopback HTTP and write the
                             bearer to a new owner-only absolute-path file
  --http-port <port>         With --http-token-file, use this port (default: OS-assigned)
  --check-update             Check for CLI updates
  --version                  Show version number
  -h, --help                 Show this help message

Commands:
  robota init                      Initialize AGENTS.md and .robota/settings.json
  robota doctor                    Diagnose configuration and runtime readiness (aliases: checkup, diagnose)
  robota doctor --repair <id> [-y] Apply one allowlisted repair after confirmation
  robota trust [status|grant|revoke] [--yes]
                                  Inspect or change the current workspace trust grant
  robota open '<robota://open?v=1&prompt=...&cwd=...>'
                                  Open a deep link: start a session in the linked, already-trusted
                                  directory with the prompt prefilled and unsent. It takes exactly
                                  one link; your own flags still apply after it.
  robota usage [options]           Show 7/30-day cross-session personal usage (text or JSON)
  robota session list [--format text|json]
                                  List live processes, saved records and supervised sessions separately
  robota session view [--cwd <directory>] [--screen-reader|--no-screen-reader]
                                  Live supervised sessions across projects, or one directory (TTY only)
  robota session start --background
                                  Start a supervised session that outlives this terminal (no attach yet)
  robota session stop <supervised-id>
                                  Stop a supervised session owned by this user
  robota mcp serve [options]       Serve one Robota session over stdio or authenticated loopback HTTP
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
