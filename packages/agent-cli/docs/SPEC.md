# SPEC.md — @robota-sdk/agent-cli

## Purpose

Interactive terminal AI coding assistant: a React + Ink TUI for running AI agents from the command
line. The CLI is a **thin shell** over `@robota-sdk/agent-framework`'s `InteractiveSession` — all
session lifecycle, slash-command execution, tool orchestration, and abort handling live in the SDK.
The CLI resolves inputs (args, settings, env), assembles a product via `assembleProduct`, and binds
one of several presentations: interactive TUI (default), print/headless (`-p`/`--goal`), the
headless runtime host (`--serve`), or an MCP server process (`robota mcp serve`).

**Product shell, not a composition root (ARCH-005 S2).** `robota`'s product identity — branding,
provider surface, presets, capability packs, base command modules, and injected
transports/runners/subagent factory — is declared as DATA in `src/product/robota-profile.ts` and
folded by the product-neutral `assembleProduct` (`@robota-sdk/agent-product`). The CLI parses args,
performs user-owned settings/env reads, accepts the host's trusted/restricted project-access
decision, and dispatches print/serve/TUI mode; it no longer hand-wires the assembly. `robota` is one
profile among many — an external repo brings its own and reuses the same kernel.

## Boundaries

The CLI does not own, and must not import the internals of: session/persistence adapters (owns none,
must not import `@robota-sdk/agent-session`), tools (`@robota-sdk/agent-tools` forbidden — tools are
assembled internally by the framework), permission/hook mechanics (only public types from
`agent-core`), config/context loading, `@file` prompt reference resolution, context-reference
inventory, automatic project memory capture/retrieval/storage, edit-checkpoint capture/storage,
`InteractiveSession` itself, `CommandRegistry`/`ICommand`/`ICommandSource`, background/subagent
lifecycle contracts, transparent-workflow provenance/state vocabulary, baseline workflow storage, or
Ink TUI components/hooks (owned by `@robota-sdk/agent-ui-terminal`).

The CLI owns: argument parsing and process lifecycle assembly, `TransportRegistry`, provider
composition (selecting an injected `IProviderDefinition`, not implementing providers), concrete local
host adapters (background runner, child-process subagent, Git worktree, settings I/O), package-version
update checks, and the per-mode host-action adapters (`/remote-control`, process exit) CMD-004 wires.
Remote control receives only the session capabilities required by its wire protocol and host-owned
effects for initial transport admission and confirmed reconnect promotion. Reconnect candidates
remain outside the registry; promoting the confirmed winner replaces the registered peer so host
shutdown reaches the live connection. Pairing failure and reconnect-window expiry still release
the transport, signaling, and session-scoped resume bridge. A later enable replaces this controller's
retained registry entry rather than attempting a duplicate registration. Expired or stopped
reconnect windows cannot start a room whose rendezvous derivation finishes afterward.
It chooses its user-local storage root and passes explicit paths to SDK persistence and trust adapters.
Direct and slash user-local commands receive that same CLI-owned Robota root; the neutral command
and framework packages never infer it from the process home.
It also chooses the Robota display-name fallback and user-local external-preset directory before
passing explicit values to the neutral preset resolver and loader. A second product chooses its own
identity and preset root without inheriting Robota's defaults.
The CLI also owns the ordered Robota/Agents/Claude-compatible agent-definition roots, passes them to
print, serve, and terminal sessions, and lists those same project roots in the pre-trust preview.
The CLI owns its ordered Robota and Claude-compatible project settings layers and passes them to
trusted session construction and the pre-trust preview from one source; restricted sessions cannot
gain a project settings reader by naming those paths.
The CLI owns one Robota project-state layout for sessions, replay logs, memory, and checkpoints. It
binds that layout when workspace trust issues an authority and lists the same directories in the
metadata-only pre-trust preview. An externally supplied trusted authority with a different state
layout is refused rather than reading or writing a path the preview did not name. Restricted
composition uses user session storage and never obtains a project-state facet.
The CLI selects its ordinary context-discovery permission baseline for Robota, Agents, and Claude
project directories and passes it to print, serve, and terminal sessions. SDK consumers inherit no
Robota file permissions unless they explicitly choose them.
The CLI adds its own setup, diagnostics, and resume commands to typed SDK failures: missing provider
configuration receives Robota setup guidance, invalid user settings point to `robota doctor`, and a
completed fork can be reopened with `robota --resume <session-id>`.
When a trusted interactive user approves a project-wide tool permission on a host with guarded
project mutation support, the session persists it through the CLI-selected project-local settings
path and its live workspace authority. An unavailable writer rejects that approval explicitly.
It also selects the ordered Robota and Claude-compatible user settings layers and passes them
through print, serve, terminal, and eval sessions, including provider switching after startup. The
Robota settings path also controls reset, terminal model writes, and plugin enablement; disabled
plugins stay disabled across command, theme, and interactive discovery.
The CLI owns the Robota bundle plugin directory for install, command reload, interactive hooks,
and the pre-trust project-source preview. It passes the selected user and project directories to
print, serve, and terminal sessions; project hooks still require live workspace trust.
The CLI owns its ordered skill and legacy-command roots and passes them with the same composed
contribution sources to command discovery, print, serve, terminal activation, doctor inspection, and
the pre-trust project-source preview. Restricted composition omits project contribution sources;
root descriptors alone never grant project access.
The CLI selects `.agents/tasks` as its task-context directory and forwards that same selection to
print, serve, and terminal sessions and to the metadata-only pre-trust preview. The framework chooses
no default task directory; a disabled or custom host selection changes the loaded and inventoried path
together. Project settings may override the directory after trust, so that project-selected path is
not read or revealed by the pre-trust preview.
The CLI selects the Robota organization-policy file and passes its path to the neutral loader,
preserving policy enforcement across its command and session surfaces.
For interactive keybindings, the CLI selects the Robota user file and schema URL and passes both
to the terminal source; the terminal package does not infer a product-owned location or schema.
The CLI also supplies `Robota` as the interactive display name, keeping its transcript labels,
terminal title, and restart copy while the terminal renderer retains a neutral default.

**Local peer activity (#2726).** The host may publish only fixed, content-free activity states for
its current interactive session into the same guarded, same-user rendezvous as peer discovery. The
observation is separate from PID/start-time liveness: stale observations or unverified processes
remain `unknown`. A TUI session switch clears the previous observation and detaches its listeners;
neither conversation content nor stored-session identity is inferred from the peer entry.
`robota session list` reads this guarded presence without announcing a new process and shows it
separately from user-owned and currently authorized project session records. A matching ID does
not prove a peer owns a saved record; corrupt and unsupported records remain visible, and neither
transcript content nor untrusted project records are included. This inventory is not a background
supervisor or an attach/restart promise.

**Opt-in supervised sessions (#2726).** `robota session start --background` admits the current
project through the same headless trust boundary before starting an independent, same-user runtime.
Each supervised runtime owns its own session and guarded local control endpoint; it survives the
launching terminal, and `session list` reports its supervisor-issued identity separately from peer
presence and saved records. Unpublished starts do not appear; a damaged registration is shown as
unavailable without hiding healthy sessions. `session stop <supervised-id>` acts only through the live owner's control
endpoint and reports failure when ownership or completion cannot be established. No session content,
launch environment, or provider credentials appear in the control records or list. Existing GUI and
ordinary `--serve` processes retain their window/process shutdown behavior. This stage does not
promise attach, peek, automatic restart after crash or login, or a relationship to a saved record.
The default WebSocket retains its transport-owned, per-launch auto-minted authentication token;
this stage does not expose that token through the session inventory or control endpoint.

**Explicit local OTLP export (#2726).** `robota usage export` reads the same authorized user and
project session stores as local usage reporting. Its default signal sends aggregate, non-additive
usage Gauges; an explicit trace signal sends verified prompt-execution roots and any causally
linked, content-free provider-call and awaited tool-body children. Both go
only to a caller-named loopback OTLP/HTTP JSON collector. Neither auto-exports or sends transcript,
tool names, session identity, or provider/model labels. An incomplete store or collector partial
rejection fails visibly. Missing or malformed old roots are counted but never synthesized. A trace
export is not a managed remote telemetry destination or an end-to-end distributed trace.
An explicitly selected logs signal sends only content-free completion-event snapshots derived
from the same validated trace records; it never exports the sensitive session replay log. It
rejects partial acceptance and unsafe destinations in the same way. Re-export can append duplicate
events, and this signal does not claim live logging or the full product-event catalog.

Reusable CLI/TUI code must not special-case command module names (e.g. `/agent`); it accepts
`commandModules` and registers them generically with the SDK registry.

### Import Rules

| Source                  | Allowed                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agent-framework`       | SDK-owned APIs and facades                                                                                   |
| `agent-core`            | Public types + utilities only; internal engine (`Robota`, `ExecutionService`, `ConversationStore`) forbidden |
| `agent-session`         | Forbidden — the SDK provides its own session/permission types                                                |
| `agent-tools`           | Forbidden — the SDK assembles tools internally                                                               |
| `agent-command`         | Slash-command modules only                                                                                   |
| `agent-subagent-runner` | Subagent/background runner only                                                                              |
| `agent-provider`        | Provider definition assembly only                                                                            |
| `agent-preset`          | Preset id selection + resolution only — `resolvePreset` owns the precedence merge                            |

## Design decisions

### Self-contained bundle (INFRA-028)

`@robota-sdk/agent-cli` publishes a self-contained bundle for its supported CLI entry points,
independent of sibling packages' publish state: workspace modules those paths need (including
`@robota-sdk/agent-command-workflows` and its DAG runtime) are compiled into `dist`, declared as
`devDependencies` only, so the published package's runtime `dependencies` contain zero `@robota-sdk`
packages — `npm install @robota-sdk/agent-cli` never resolves an `@robota-sdk` sibling. `/workflows`
is always bundled and present; its local runtime uses a fixed base node catalog plus saved instant
nodes, not the larger async catalog available only inside this workspace.

The invariant "agent-cli runtime `dependencies` have zero `@robota-sdk`" is enforced by
`scripts/harness/check-publish-safety.mjs`.

**What a `--session-log` replay executes (issue #2302).** The replay substitutes the MODEL, never the
tools: a recorded `toolCalls` entry is dispatched against the session's live tool set and the real
result is appended to the conversation — a call naming a tool the session does not have produces an
error tool result and the run advances. This dev-only feature (`agent-provider-replay`, INFRA-017) is
not bundled in published installs.

### MCP client composition (MCP-002)

`@robota-sdk/agent-mcp` owns definition decoding, precedence, admission policy, and the
connection/catalog manager; this package's one job is making that manager reachable from the
product's own startup rather than only from tests. Every unreadable/corrupt settings layer and every
decode refusal is reported as a problem, never silently dropped; zero resolved definitions is a
normal, silent-diagnostic outcome. A caller-supplied `mcpActivationAdapter` always wins over CLI
composition and skips it entirely.

**Bounded MCP results (MCP-2525).** Every discovered tool's result passes a core result-admission
policy before reaching the session's permission, callback, log, or provider path. The default
warning/hard/repository ceiling is 10,000/25,000/500,000 UTF-16 code units; embedding hosts may
configure limits within the repository ceiling. A failed spill produces a secret-free refusal — raw
server output is never substituted back into context. `robota_read_mcp_result` returns at most 4,000
characters per read (less under a host-configured hard limit), with the total size and next offset;
missing or expired references fail with a fixed, payload-free error.

**Stdio client authority (MCP-2522).** Definitions and settings cannot grant execution authority on
their own: an approved stdio definition without a separately supplied host authority is diagnosed and
never spawned. Stdio discovery diagnostics never include raw child or SDK errors, and the ordinary
executable does not auto-approve package-runner commands.

**Current limitation.** Approval is in-memory and session-scoped per process: a server approved via
`/mcp approve` mid-session is not connected by that already-started session. An embedding host can
supply its own `IMCPActivationApprovalStore` before `robota mcp serve` starts to admit and connect
approved definitions ahead of building the served runtime session.

**External event source opt-in (#2726).** The interactive TUI alone accepts repeatable
`--external-event-allow <serverId>:<senderId>` launch grants. Each named server must already be
admitted and connected through the ordinary MCP policy and must declare the exact external-event
capability; configuration or activation approval alone never enables injection. The CLI trusts an
explicitly granted MCP server as the platform adapter that attests sender identity over its
authenticated connection, then independently checks the exact per-server sender allowlist in the
session-owned ingress. The notification's sender string alone is not proof of identity: operators
must grant only servers they trust to verify their platform's sender credentials. Events are one-way,
bounded, and processed only while this TUI session and its MCP connection are live. An admitted
external turn can produce model text but cannot invoke model-generated local or hosted web tools;
trusted hooks/plugins are not isolated by this limit. The grant and sender string do not themselves
prove platform authentication, so operators without a verified adapter should leave the flag off.
Automatic platform replies, remote permission approvals, and response relays are unavailable.
Print, goal, serve, and MCP-serve modes refuse
the flag rather than silently ignoring it. Repeated connection loss stops after bounded retries;
the host must restart or explicitly retry rather than assuming delivery from a dead channel.

### MCP background handoff settings (MCP-004)

A long-running MCP tool call blocks the turn unless the host opts a session into handing it to a
background task. Settings (`mcp.autoBackgroundMs` default 120000, `mcp.callTimeoutMs` default 600000)
are read from the same layered settings documents `mcpServers` is read from — never through the
framework's schema-typed `SettingsSchema`, which does not declare `mcp`. Layering is per-key (not
whole-object like `mcpServers`): each key folds independently across layers, so a managed policy can
fix one key while leaving the other to the user layer. `autoBackgroundMs: 0` disables the handoff
silently; `autoBackgroundMs >= callTimeoutMs` disables it with exactly one diagnostic. A negative or
non-integer value for either key refuses that document's WHOLE `mcp` object (both keys), and folding
continues as if no `mcp` object had been declared — the default is never silently substituted for an
invalid value. Print mode never adopts the handoff policy (a one-shot run has no drain) and reports a
diagnostic when the setting would otherwise apply.

### `--serve` runtime host (RUNTIME-001)

`--serve` runs `startRuntimeHost` over the resolved runtime options and the loopback `WsTransport`,
rendering no UI, until SIGTERM. This is the backend the desktop GUI spawns: TUI and GUI are sibling
presentations over the same runtime host, and the GUI never controls the CLI. The composition root
assigns trusted WS driver identities (`app`, `browser`, `remote:ws`) so a turn's persisted usage
surface reflects the launch path rather than a client-provided claim.

ARCH-011 runner propagation is explicit in serve mode: `waitForFailure()` returns the first named
nonzero runner outcome without waiting for unrelated runners, and serve mode assigns that exact exit
code. A rejected runner wait assigns exit 1; no runners, all-success, or stop-abandonment leave the
service alive.

### `robota mcp serve` (MCP-007)

A separate headless process mode: one normally assembled session plus one `agent-transport-mcp`
stdio (or, with `--http-token-file`, loopback HTTP) service. It uses the caller's working directory
and the same headless project-access/trust decision as `--serve`, and never prompts for trust over
the protocol stream. From entry until shutdown, all product notices use stderr while stdout is
reserved for MCP frames. SIGINT, SIGTERM, stdin/client close, startup failure, and carrier failure all
enter one idempotent cleanup path; a normal close exits 0, a failure exits nonzero. No WebSocket or
TUI transport starts in this mode.

The HTTP token-file variant creates the token file exclusively with owner-only permissions, never
puts the bearer in command arguments or stdout, and removes its own token file during shutdown; it
refuses a relative token path or an existing file.

### Memory, screen-reader, theme, and prompt-history enablement

Each of these product surfaces is **opt-in and resolved by the CLI**, not the library it configures
(HARNESS-029 library neutrality) — precedence order and defaults for each are non-obvious and stated
here because the reasoning differs between them:

- **Durable memory (SELFHOST-008 P6):** default OFF. Precedence lowest→highest: `settings.json`
  `memory.enabled` → `--memory`/`--no-memory` flag → `ROBOTA_MEMORY` env (**env wins** — a
  machine-level policy a CI runner sets once). Capture + recall are enabled together by one switch;
  scope is repo/project (`<cwd>/.robota/memory/`). A one-time enable notice is printed to stderr on
  first enable; no blocking prompt.
- **Screen-reader mode (CLI-2004):** default OFF. Precedence lowest→highest: `settings.json`
  `screenReader` → `ROBOTA_SCREEN_READER`/`INK_SCREEN_READER` env → `--screen-reader`/
  `--no-screen-reader` flag (**flag wins**). This is a deliberate divergence from memory's
  precedence: accessibility must let a per-invocation flag turn the mode ON for one run on a machine
  whose environment has it off (e.g. SSH into a shared host), while memory is a machine-level policy.
  Auto-detection only ever prints one advisory line; it never enables the mode itself — a false
  positive on this feature costs a line of text, while auto-enabling on one would reshape a sighted
  user's interface with no telemetry to ever catch it.
- **Prompt history (SCREEN-1993):** default ON (prompts are already persisted verbatim per session,
  and this is a shell-history analogue). Precedence: `settings.json` `promptHistory: false` ←
  `ROBOTA_PROMPT_HISTORY` env (**env wins**, same direction as memory — a machine-level policy).
  TUI only; print/serve receive no writer.
- **Theme registry (SCREEN-2002):** one registry is built per run and handed to both the `/theme`
  command and the renderer, so a listing and a switch can never disagree about which themes exist. A
  run that renders no terminal UI gets no registry and reads no theme file at all. Appearance is
  re-read per call, never captured at startup, so a `/theme list` after an `appearance-settings-patch`
  reports the change that was just made. Theme/plugin ids are constrained to `[A-Za-z0-9._-]` at 24
  characters per segment so a composite id fits the 60-character name bound; a file or plugin outside
  that is skipped with a reason rather than loaded, and the first file to claim an id keeps it.

### Workspace trust and project access (ARCH-042, SECURITY-2465)

The CLI resolves one host-owned `TWorkspaceProjectAccess`/`WorkspaceTrustService` decision before
composition. Absence is deterministically **Restricted**: only user contribution/settings sources and
the user session store are available, no project memory, and `cwd` alone cannot mint any project
capability. **Trusted** composition derives project sources plus named state facets from the exact
runtime-accepted authority, and is refused when the real CLI working directory is outside the
authority's frozen workspace root. Print mode, `--goal`, and `--serve` fail closed for
`untrusted`/`revoked`/`stale`/`store-unavailable` decisions before provider construction; interactive
startup may continue Restricted with project contributions disabled. All trust diagnostics expose
only state and canonical display path — credentials and project-controlled content are never printed.

### Deep links (`robota open`)

Decided BEFORE argument parsing and before any workspace composition, so a malformed or untrusted
link is named as such rather than reported as a missing terminal. The grammar is closed: verb
`robota://open` (case-insensitive) and exactly four keys (`v` required as `1`, `prompt`, `cwd`,
`repo`). An unknown/duplicate key, wrong/missing `v`, an oversized link or prompt, a prompt starting
with `/`, a relative/UNC/`..`-bearing `cwd`, or a second link in argv discards the WHOLE url and exits
non-zero without starting a session; every echoed value is escaped first. The target must already be
`trusted` — there is no link-specific grant. `repo=` resolves only against recorded trusted clones and
never clones or fetches.

### Zero-config startup (env-default)

When no provider profile exists but a recognized provider env key is set, the CLI starts anyway by
synthesizing an in-memory config from the provider definition's defaults; nothing is persisted and a
settings profile always wins over this synthesis. Exactly one notice line is printed (provider, model,
env var name — never the key value) pointing at `--configure` to persist a profile.

### Provider profile resolution

The CLI must not branch on provider type names to decide defaults, required fields, setup prompts, or
constructor behavior — those come from the injected `IProviderDefinition` records. The profile key
(`currentProvider`) is a stable selection identity independent of provider `type`; resolution order is
`currentProvider` + `providers[...]`, then legacy `provider`, then the resolved definition's defaults.
Environment-variable API key references use `$ENV:NAME`; an unresolved `$ENV:NAME` must never be sent
as an API key, and setup validation fails first with a clear error. First-run/non-interactive setup
generates a profile key from the provider/model, with a numeric suffix on collision, and that
generated key must never include credential fragments or account identifiers.

### Distribution — Bun single binary (DIST-001)

Alongside the npm/Node package, `agent-cli` can be compiled to a standalone executable via Bun.
**Bun is used for build/packaging only — never at runtime**, and no Bun-specific APIs are used; the
Node entry path is retained unconditionally. A literal build target must exactly match the current
host tuple; every unsupported host is refused before compilation, leaving the previously selected
binary generation unchanged.

**Constraint removed by DIST-006:** a subagent turn used to spawn a child `node` process against a
worker file, which required `node` on `PATH` and did not work at all in a compiled binary (the worker
file was never emitted into the artifact). The binary now re-executes itself
(`process.execPath`) instead, so no external `node` is named anywhere on this path; non-subagent CLI
use needs no Node install regardless.

## User-facing contract

The consumer of `agent-cli` is the person at the terminal (or the script invoking it); the items below
are what they can rely on.

### Modes and flags

```bash
robota                               # Interactive TUI
robota init                          # Initialize project (AGENTS.md + .robota/settings.json)
robota open '<robota://open?v=1...>' # Open a deep link into a trusted directory
robota trust status | --yes | revoke --yes   # Inspect/grant/revoke workspace trust
robota doctor [--repair <id> -y]     # Diagnose configuration/runtime readiness (aliases: checkup, diagnose)
robota usage [--period 30d] [--timezone UTC] [--format json]  # Local personal usage summary
robota eval ./my-eval.mjs            # Run an evals-as-code definition; exit 1 on a metric breach
robota -p "prompt"                   # Print mode (one-shot, headless)
robota --serve                       # Headless runtime host (RUNTIME-001)
robota mcp serve [--http-token-file <path> [--http-port <port>]]  # MCP server process (MCP-007)
robota -c | --continue                       # Continue the most recent session for this cwd
robota -r <id> | --resume [id]               # Resume a session by id/name, or show a picker
robota -c --fork-session                     # Fork from the last session (new id, restored context)
robota --name <name> | --reset | --model <model> | --language <lang>
robota --permission-mode <plan|default|acceptEdits|bypassPermissions>
robota --max-turns <n> | --goal <objective> [--goal-max-iterations <n>]
robota --allowed-tools <list> | --denied-tools <list>
robota --json-schema <schema> | --output-format <text|json|stream-json>
robota --system-prompt <text> | --append-system-prompt <text>
robota --check-update | --disable-update-check | --version
```

`--output-style <id>` selects the provider-neutral response style (flag > persisted `outputStyle`
setting > `default`); `--effort` (or `ROBOTA_EFFORT`/settings/preset) selects the model-effort tier
from `auto`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` — invalid values are terminal
startup errors.

### Session resolution

`--continue`/`-c` resumes the most recent session for the cwd (reusing its id); `--resume [id]`
resumes an explicit id/name or shows a picker when omitted; `--fork-session` (combined with either)
creates a fresh id while restoring the resumed context, leaving the original file untouched.
`-c` with no prior session for the cwd starts a new one — identical in TUI and print mode. Print mode
requires an explicit `-r <id|name>` (no interactive picker) and rejects `--no-session-persistence`
combined with `-c`/`-r`.

### Destructive actions

Every destructive CLI flag (e.g. `--reset`) follows one contract: nothing is deleted without consent.
On a TTY without `--yes` it prompts `Delete <path>? [y/N]`; on a non-TTY without `--yes` it refuses and
names the flag; `--yes`, or `CI=true` for `robota init`'s confirmations, skips the prompt. `--yes`
means "non-interactive with documented defaults", not "answer yes to everything" — `robota init` never
overwrites existing files even with `--yes`.

### Exit codes

| Code | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 0    | Success or user interruption                                                                 |
| 1    | Execution error — argument parse errors, provider API failures, user-local command errors    |
| 3    | Provider configuration error at print-mode session start — reconfigure, do not retry         |
| 130  | Interactive TUI force-quit — a second Ctrl+C/signal while a graceful shutdown is in progress |

A provider API failure during a model call must never exit 0.

### Default loop prompt

The default `/loop` prompt comes from a trusted project's `.robota/loop.md`, then the user's
`~/.robota/loop.md`, then the built-in maintenance prompt. The chosen file is re-read for each
iteration, so edits take effect without restarting the session. A present but invalid file fails
visibly instead of falling through; project content is considered only with explicit workspace
trust. File prompts are bounded to 4096 UTF-8 bytes and convey no new permissions.

### CLI update check

The CLI owns its package identity, install guidance, and user-local update-check cache. The
framework provides only reusable version comparison and string utilities.

Enabled by default only for interactive TUI startup, rate-limited by a 24-hour TTL; a registry lookup
failure must never prevent startup. Print/headless execution never schedules or emits update checks,
keeping automation and structured stdout/stderr contracts deterministic. The CLI may print the install
command but must never execute install/update commands without explicit user confirmation.

- `robota trust status` previews the project sources that trusting the current workspace would enable,
  using metadata only: it never follows links, never reads file content and never prints credentials
  or project-controlled content. Where safe metadata is unavailable it lists candidate names with
  metadata marked unavailable.

## Known limitations

- Korean IME on macOS Terminal.app can crash the terminal (SIGSEGV) during IME composition; use
  iTerm2, or rely on the CLI's blank-line workaround that stabilizes cursor position.
- The Bun single-binary distribution's subagent-spawns-itself path (`process.execPath`) has been
  measured for the worker IPC handshake on Linux; a full end-to-end subagent turn from the compiled
  binary (which additionally needs a model provider in the child) has not been run.
