import type { ICliRuntimeContext } from '../product/runtime-context.js';
/**
 * CLI usage help text.
 *
 * Split out of `cli-args.ts` (CLI-2004) by responsibility: that module parses and validates
 * arguments, this one is the user-facing catalogue of them. Keeping a ~65-line template literal
 * inside the parser is what made adding one flag a size-budget question instead of a one-line edit.
 * Re-exported from `cli-args.ts` so every existing import site keeps working unchanged.
 */

const USAGE = `
Usage: {{cli}} [options] [-p <prompt>]
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
  --goal <objective>         Pursue an objective across turns without a person, then exit
  --goal-max-iterations <n>  Turn budget for --goal (default 25)
  -c, --continue             Continue the most recent session
  -r, --resume <id>          Resume a session by ID or name
  -n, --name <name>          Name for the new session
  --fork-session             Fork the current session into a new independent session
  --task-file <path>         Read a task prompt from file and append it to the system prompt
  --bare                     Print mode: skip instruction files (AGENTS.md, CLAUDE.md) and plugins
  --safe-mode                Start with every customization off: instruction files, skills,
                             commands, agents, output styles, plugins, hooks and MCP servers.
                             Use it first when something misbehaves; if the problem goes away,
                             one of them is the cause
  --configure                Run interactive provider configuration
  --configure-provider <n>   Configure a specific provider
  --type <type>              With --configure-provider: the provider type
  --base-url <url>           With --configure-provider: the provider's base URL
  --api-key <key>            With --configure-provider: the API key to store
  --api-key-env <name>       With --configure-provider: store a reference to this environment
                             variable instead of the key itself
  --settings-scope <scope>   Which settings file provider setup writes: user | project-local
  --provider <profile>       Use this provider profile for the run
  --set-current              With --provider or --configure-provider: save it as the default
  --allowed-tools <list>     Comma-separated tool auto-approval list
  --denied-tools <list>      Comma-separated tool denylist
  --model <model>            Model override for this run
  --fallback-model <list>    Comma-separated models to continue a turn on when the model is overloaded
  --effort <level>           Model effort: auto | none | minimal | low | medium | high | xhigh | max
  --advisor <profile[:model]> Model the main model may consult for advice (or "off");
                             overrides settings.json advisorModel. PRODUCT_DISABLE_ADVISOR=1 turns it off
  --preset <id>              Preset id to apply (default: settings.preset or "default")
  --output-style <id>        Response style: default | concise | proactive | explanatory | learning
  --memory / --no-memory     Enable/disable durable memory for this run (default: off; opt-in).
                             Overrides settings.json memory.enabled; PRODUCT_MEMORY=1|0 overrides both
  --memory-autosave          With memory on, auto-save captured facts (default: approval-required queue)
  --screen-reader            Plain-text screen-reader mode: no box-drawing chrome, no spinners,
                             role-labelled transcript, numbered menus, bell + OSC 133 turn marks.
                             Overrides PRODUCT_SCREEN_READER=1|0 and settings.json screenReader
                             Pacing: PRODUCT_SCREEN_READER_STARTUP_QUIET_MS (default 900) and
                             PRODUCT_SCREEN_READER_PREPARK_MS (default 50, 0 disables) in milliseconds
  --no-screen-reader         Force screen-reader mode off for this run
  --reduced-motion           Suppress animation for this run; colour is unaffected.
                             Overrides PRODUCT_REDUCED_MOTION=1|0 and settings.json reducedMotion
  --no-reduced-motion        Allow animation for this run, overriding a persisted reducedMotion
  --json-schema <schema>     Print mode: instruct the model to respond with JSON matching this schema
  --session-log <path>       Replay a recorded session log instead of calling a model
  --dry-run                  Alias for --permission-mode plan (plan only, no execution)
  --reset                    Delete {{settings}} (provider profiles and preferences).
                             Asks for confirmation; use --yes to skip
  --yes                      Skip confirmation prompts (required for --reset in non-TTY)
  --serve                    Run the headless runtime over a loopback WebSocket
  --serve --open             Serve {{name}} over localhost and open it in a browser
  --serve --http-port <port> Also serve the agent HTTP API (submit with SSE streaming, commands,
                             abort, messages) on 127.0.0.1:<port>, for other apps and services.
                             Requires PRODUCT_HTTP_TOKEN (at least 32 characters): the bearer
                             every request presents. Reach it from elsewhere through your own
                             reverse proxy or tunnel, or bind it as an OAuth resource server
                             with --http-public-url and the --oauth-* flags instead of the bearer
  --restricted-workspace     With print mode, --goal, --serve, daemon start or session start:
                             start without the project's settings, hooks, plugins, skills and
                             MCP servers
  --attach [--screen-reader|--no-screen-reader]
                             Open the full terminal UI on this workspace's running daemon
                             ({{cli}} daemon start) instead of starting a session: its
                             conversation, prompts and sessions, alongside its other clients.
                             Takes no session option; the daemon's session is the daemon's.
                             It needs an interactive terminal and your confirmation, so only
                             the user can run it; a script or agent should suggest it, or
                             connect to the URL {{cli}} daemon start --json prints. Detaching
                             keeps the daemon running; exits 0 after detaching, 1 otherwise
  --http-token-file <path>   With mcp serve, bind authenticated loopback HTTP and write the
                             bearer to a new owner-only absolute-path file
  --http-port <port>         With mcp serve HTTP, use this port (default: OS-assigned); with
                             --serve, see --serve --http-port
  --http-public-url <https>  With mcp serve or --serve --http-port, serve remote HTTP as an OAuth resource server at this
                             public URL (endpoint and metadata paths follow it; the proxy in front
                             must forward those paths and preserve Host). Requires --oauth-issuer,
                             --oauth-scopes and --oauth-allowed-subjects; never uses a token file
  --http-host <ip>           With mcp serve or --serve --http-port, the address to bind. Anything but 127.0.0.1 requires
                             --http-public-url and the --oauth-* flags (default: 127.0.0.1)
  --oauth-issuer <https>     Authorization server whose access tokens are accepted
  --oauth-scopes <a,b>       Scopes every access token must carry
  --oauth-allowed-subjects <a,b>
                             Token subjects admitted to the one shared session
  --trusted-proxy <ip>       Believe X-Forwarded-For from this proxy address (repeatable)
  --check-update             Check for CLI updates
  --disable-update-check     Skip the startup update check
  --version                  Show version number
  -h, --help                 Show this help message

Commands:
  {{cli}} init                      Initialize AGENTS.md and {{projectSettings}}
  {{cli}} doctor                    Diagnose configuration and runtime readiness (aliases: checkup, diagnose)
  {{cli}} doctor --repair <id> [-y] Apply one allowlisted repair after confirmation
  {{cli}} trust [status|grant|revoke] [--yes]
                                  Inspect or change the current workspace trust grant
  {{cli}} open '<{{cli}}://open?v=1&prompt=...&cwd=...>'
                                  Open a deep link: start a session in the linked, already-trusted
                                  directory with the prompt prefilled and unsent. It takes exactly
                                  one link; your own flags still apply after it.
  {{cli}} usage [options]           Show 7/30-day cross-session personal usage (text or JSON)
  {{cli}} session list [--format text|json]
                                  List live processes, saved records and supervised sessions separately
  {{cli}} session view [--cwd <directory>] [--name <text>] [--pr <number>] [--state <state>]
                      [--screen-reader|--no-screen-reader]
                                  Live supervised sessions across projects, or filtered (TTY only)
  {{cli}} session start --background [--name <name>] [--restricted-workspace]
                      [--external-event-grant <file>]...
                      [--external-event-port <port>] [--external-event-trusted-proxy <ip>]...
                                  Start a supervised session that outlives this terminal
  {{cli}} session attach <supervised-id> [--observe] [--screen-reader|--no-screen-reader]
                                  Attach this terminal to a live supervised session: drive it, or
                                  observe it read-only (TTY and your confirmation; detaching keeps it
                                  running)
  {{cli}} session events list <supervised-id> [--json]
                                  Show a supervised session's external event grants and their counts
  {{cli}} session events revoke <supervised-id> <grant-id>
                                  Withdraw one external event grant from a supervised session
  {{cli}} session stop <supervised-id>
                                  Stop a supervised session owned by this user
  {{cli}} session rename <supervised-id> <name>
                                  Rename a live supervised session owned by this user
  {{cli}} session link-pr <supervised-id> <https-pr-url>
                                  Link a PR/MR URL to a live supervised session
  {{cli}} session unlink-pr <supervised-id>
                                  Clear a live supervised session PR/MR link
  {{cli}} daemon start [--json] [--restricted-workspace]
                                  Start this workspace's daemon, or reuse the running one; --json
                                  prints {"id","url"} for the client that connects to it
  {{cli}} daemon status [--json]    Show whether this workspace's daemon is running
  {{cli}} daemon stop               Stop this workspace's daemon
  {{cli}} daemon unlock             Remove a daemon start lock left by a start that is gone
  {{cli}} mcp serve [options]       Serve one {{name}} session over stdio, authenticated loopback HTTP,
                                  or OAuth-authorized remote HTTP
  {{cli}} mcp login <name> [--client-secret] [--no-browser]
                                  Sign in to a remote MCP server that declares oauth
                                  (--no-browser: print the URL, paste the redirect back)
  {{cli}} mcp logout <name>         Sign out of an OAuth MCP server and revoke its tokens
  {{cli}} eval <definition> [--threshold <0..1>]
                                  Run an evals-as-code definition; exit 1 on a metric breach (CI gate)

Examples:
  {{cli}}                           Start interactive TUI session
  {{cli}} init                      Initialize project files
  {{cli}} -p "Hello"                Print mode: send prompt and exit
  {{cli}} -p "Hello" --output-format json
  {{cli}} -p "Review this diff" --bare    Print mode without instruction files or plugins
  {{cli}} --task-file task.md       Run task from file (appended to system prompt)
  {{cli}} -p "Refactor the auth module" --dry-run   Plan only, no execution
  {{cli}} --continue                Resume the last session
`;

/** Return CLI usage help text. */
export function printHelp(runtime: ICliRuntimeContext): string {
  return renderHelp(`${USAGE}\nOptions:\n${OPTIONS}`, runtime);
}

/**
 * Invocations whose command prints fuller help of its own for `--help` (its options and values), so
 * the router leaves the flag to it.
 */
function hasOwnHelp(args: readonly string[]): boolean {
  const [subcommand, action] = args;
  if (subcommand === 'usage') return true;
  return (
    subcommand === 'session' && (action === 'list' || action === 'view' || action === 'attach')
  );
}

/** `{{cli}} doctor`'s aliases, answered with the doctor's entries. */
const SUBCOMMAND_ALIASES: Readonly<Record<string, string>> = {
  checkup: 'doctor',
  diagnose: 'doctor',
};

/** The `Commands:` section of the help, one entry per `{{cli}} <subcommand> …` line with its continuation. */
function commandEntries(): readonly { subcommand: string; text: string }[] {
  const start = OPTIONS.indexOf('Commands:\n');
  const end = OPTIONS.indexOf('\nExamples:');
  const entries: { subcommand: string; text: string }[] = [];
  for (const line of OPTIONS.slice(start + 'Commands:\n'.length, end).split('\n')) {
    const match = /^ {2}\{\{cli\}\} (\S+)/.exec(line);
    if (match) entries.push({ subcommand: match[1] ?? '', text: line });
    else if (line.trim() !== '' && entries.length > 0) {
      const last = entries[entries.length - 1];
      if (last) last.text += `\n${line}`;
    }
  }
  return entries;
}

/** `{{cli}} mcp serve`'s transport options, listed among the global options. */
function mcpServeOptions(): string {
  const start = OPTIONS.indexOf('  --http-token-file');
  const end = OPTIONS.indexOf('  --check-update');
  return OPTIONS.slice(start, end).trimEnd();
}

/** Whether `word` names a `{{cli}}` subcommand (or one of the doctor's aliases). */
export function isSubcommandName(word: string): boolean {
  const subcommand = SUBCOMMAND_ALIASES[word] ?? word;
  return commandEntries().some((entry) => entry.subcommand === subcommand);
}

/**
 * Help for `{{cli}} <subcommand> --help` (or `-h`): that subcommand's entries from the command list
 * above, so the two never disagree. Undefined when `args` is not such a request.
 */
export function subcommandHelpFor(args: readonly string[], runtime: ICliRuntimeContext): string | undefined {
  const first = args[0];
  if (first === undefined || !(args.includes('--help') || args.includes('-h'))) return undefined;
  if (hasOwnHelp(args)) return undefined;
  const subcommand = SUBCOMMAND_ALIASES[first] ?? first;
  const entries = commandEntries().filter((entry) => entry.subcommand === subcommand);
  if (entries.length === 0) return undefined;
  const options =
    subcommand === 'mcp' ? `\n\nOptions for {{cli}} mcp serve:\n${mcpServeOptions()}` : '';
  return renderHelp(`\nUsage:\n${entries.map((entry) => entry.text).join('\n')}${options}\n\nRun {{cli}} --help for every option and command.\n`, runtime);
}

function renderHelp(text: string, runtime: ICliRuntimeContext): string { return text.replaceAll('{{cli}}', runtime.vocabulary.cliName).replaceAll('{{name}}', runtime.vocabulary.displayName).replaceAll('{{settings}}', runtime.layout.userPaths.settings).replaceAll('{{projectSettings}}', `${runtime.layout.projectDirectory}/settings.json`); }
