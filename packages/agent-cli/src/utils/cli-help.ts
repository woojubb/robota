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
  --permission-mode <mode>   Permission mode: plan | default | acceptEdits | bypassPermissions | auto
  --external-event-grant <file>
                             TUI only: admit text-only external events whose access token
                             this session verifies for the one principal the file names;
                             repeat per grant (no tools, no reply; list or revoke with /events)
  --external-event-port <port>
                             With grants: the loopback port of POST <public-url>/events/<grant>,
                             which the owner's HTTPS proxy or tunnel forwards to
  --external-event-trusted-proxy <ip>
                             With grants: a proxy whose X-Forwarded-For is believed (repeat)
  --max-turns <n>            Maximum agent turns before stopping
  -c, --continue             Continue the most recent session
  -r, --resume <id>          Resume a session by ID or name
  -n, --name <name>          Name for the new session
  --fork-session             Fork the current session into a new independent session
  --task-file <path>         Read a task prompt from file and append it to the system prompt
  --bare                     Print mode: output raw text only, no formatting wrapper
  --safe-mode                Start with every customization off: instruction files, skills,
                             commands, agents, output styles, plugins, hooks and MCP servers.
                             Use it first when something misbehaves; if the problem goes away,
                             one of them is the cause
  --configure                Run interactive provider configuration
  --configure-provider <n>   Configure a specific provider
  --allowed-tools <list>     Comma-separated tool auto-approval list
  --denied-tools <list>      Comma-separated tool denylist
  --model <model>            Model override for this run
  --fallback-model <list>    Comma-separated models to continue a turn on when the model is overloaded
  --effort <level>           Model effort: auto | low | medium | high | xhigh | max
  --advisor <profile[:model]> Model the main model may consult for advice (or "off");
                             overrides settings.json advisorModel. ROBOTA_DISABLE_ADVISOR=1 turns it off
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
  --http-port <port>         With mcp serve HTTP, use this port (default: OS-assigned)
  --http-public-url <https>  With mcp serve, serve remote HTTP as an OAuth resource server at this
                             public URL (endpoint and metadata paths follow it; the proxy in front
                             must forward those paths and preserve Host). Requires --oauth-issuer,
                             --oauth-scopes and --oauth-allowed-subjects; never uses a token file
  --http-host <ip>           With mcp serve, the address to bind. Anything but 127.0.0.1 requires
                             --http-public-url and the --oauth-* flags (default: 127.0.0.1)
  --oauth-issuer <https>     Authorization server whose access tokens are accepted
  --oauth-scopes <a,b>       Scopes every access token must carry
  --oauth-allowed-subjects <a,b>
                             Token subjects admitted to the one shared session
  --trusted-proxy <ip>       Believe X-Forwarded-For from this proxy address (repeatable)
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
  robota session view [--cwd <directory>] [--name <text>] [--pr <number>] [--state <state>]
                      [--screen-reader|--no-screen-reader]
                                  Live supervised sessions across projects, or filtered (TTY only)
  robota session start --background [--name <name>] [--external-event-grant <file>]...
                      [--external-event-port <port>] [--external-event-trusted-proxy <ip>]...
                                  Start a supervised session that outlives this terminal
  robota session attach <supervised-id> [--observe] [--screen-reader|--no-screen-reader]
                                  Attach this terminal to a live supervised session: drive it, or
                                  observe it read-only (TTY and your confirmation; detaching keeps it
                                  running)
  robota session events list <supervised-id> [--json]
                                  Show a supervised session's external event grants and their counts
  robota session events revoke <supervised-id> <grant-id>
                                  Withdraw one external event grant from a supervised session
  robota session stop <supervised-id>
                                  Stop a supervised session owned by this user
  robota session rename <supervised-id> <name>
                                  Rename a live supervised session owned by this user
  robota session link-pr <supervised-id> <https-pr-url>
                                  Link a PR/MR URL to a live supervised session
  robota session unlink-pr <supervised-id>
                                  Clear a live supervised session PR/MR link
  robota mcp serve [options]       Serve one Robota session over stdio, authenticated loopback HTTP,
                                  or OAuth-authorized remote HTTP
  robota mcp login <name> [--client-secret] [--no-browser]
                                  Sign in to a remote MCP server that declares oauth
                                  (--no-browser: print the URL, paste the redirect back)
  robota mcp logout <name>         Sign out of an OAuth MCP server and revoke its tokens
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
