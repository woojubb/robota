# SPEC.md — @robota-sdk/agent-cli

## Purpose

Interactive terminal AI coding assistant: a React + Ink TUI for running AI agents from the command
line. The CLI is a **thin shell** over `@robota-sdk/agent-framework`'s `InteractiveSession` — all
session lifecycle, slash-command execution, tool orchestration, and abort handling live in the SDK.
The CLI resolves inputs (args, settings, env), assembles a product via `assembleProduct`, and binds
one of several presentations: interactive TUI (default), print/headless (`-p`/`--goal`), the
headless runtime host (`--serve`), or an MCP server process (`robota mcp serve`).

**Product shell, not a composition root.** `robota`'s product identity — branding,
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
Ink TUI components/hooks (owned by `@robota-sdk/agent-ui-terminal`). Non-UI behavior exposed through
the CLI is owned below it first unless it is listed as CLI-owned below.

The CLI owns: argument parsing and process lifecycle assembly, `TransportRegistry`, provider
composition (selecting an injected `IProviderDefinition`, not implementing providers), concrete local
host adapters (background runner, child-process subagent, Git worktree, settings I/O), package-version
update checks, and the per-mode host-action adapters (`/remote-control`, process exit) through which the session executes a command's host actions.
Remote control is host-owned: it receives only the session capabilities its wire protocol needs, and
promoting a confirmed reconnect winner replaces the registered peer so host shutdown always reaches
the live connection; pairing failure or reconnect-window expiry releases the transport, signaling,
and resume bridge, and an expired or stopped window cannot start a room after the fact.
The CLI selects every user- and project-scoped path and identity a session needs — storage root,
presets, agent-definition roots, project settings layers, project-state layout, context-discovery
permissions, plugin/skill/command roots, task-context directory, organization policy, keybindings,
and display name — and passes them explicitly to the neutral SDK and framework packages, which never
infer a path or identity on their own; a second product supplies its own values without inheriting
Robota's. Restricted (untrusted) composition never gains a project settings or contribution source
merely by knowing its path, and an externally supplied trusted authority whose project-state layout
differs from the CLI's is refused rather than read or written. Project-wide tool-permission approvals
persist only through the CLI-selected project-local settings path and the live workspace authority;
an unavailable writer rejects the approval explicitly. Disabled plugins stay disabled across every
command, theme, and discovery surface. The CLI attaches its own setup, diagnostics, and resume
guidance to typed SDK failures — missing provider configuration, invalid settings, or a completed
fork — and supplies the product's diagnostic and resume commands to command modules, which name no
Robota executable or product on their own.

Local peer-activity publishing exposes only fixed, content-free activity states for the current
interactive session into a guarded, same-user rendezvous, kept separate from process-liveness checks
(stale or unverified observations read as `unknown`) and never carrying conversation content or
stored-session identity. `session list` shows this presence separately from saved session records
without implying a background supervisor or an attach/restart capability; it includes only
user-owned and currently authorized project records, never transcript content, and corrupt or
unsupported records stay visible rather than being hidden.

Supervised background sessions (`session start --background`) run as independent, same-user
processes behind the same headless trust boundary, each with its own guarded local control endpoint
that survives the launching terminal. The session list reports only content-free activity and
liveness for them — never session content, launch environment, or provider credentials. Unverified
identity, a missing control response, initialization, or shutdown read as `unknown`; `idle` means
only that the session is initialized with no pending question and is not executing, not that
another CLI can attach or submit a prompt. A waiting loop's next eligible time is reported only when
observed from the live owner, and does not promise that a future wake will run.

The global supervised view observes only that guarded inventory, and narrows by owner-reported name,
directory, or linked PR only on a live owner-verified path. It does not join peer or saved-record
identities, show conversation content or project paths in ordinary rows (verified paths appear only
when the viewer groups by directory), treat an exited process as completed, or show stale PR links;
PR URLs never enter ordinary listings or registration records. Starting a session from the view
still requires headless workspace trust for its target directory, and closing the view never stops
a supervised session. A damaged registration is shown as unavailable without hiding healthy
sessions. A stop, rename, or PR-association request acts only through the live owner's control
endpoint and fails explicitly when ownership or completion cannot be established. Attach, peek, and
automatic restart are not offered, and the transport's per-launch authentication token is never
exposed through the control endpoint or inventory.

Observability has two independently gated paths. `usage export` is an explicit,
local-only action over the same authorized stores as local usage reporting: its aggregate usage,
verified content-free execution traces, or completion snapshots go only to a caller-named loopback
collector, never including transcript, tool names, session identity, or provider/model labels.
It fails visibly on an incomplete store or collector rejection and never auto-exports. The separate
live telemetry path needs an explicit Robota enable switch, individually selected signals, and an
explicit protocol with a validated destination (OTLP or a local console sink). It uses host-owned
resource and trace identity, never ambient OpenTelemetry identity, trace context or credentials, and
sends a trace's identifiers to a provider only at origins the operator listed exactly, and to a
child process only of a class the operator listed, while traces are exported — the collector's origin and credentials are never implied by that. Its spans, metrics
and console output are always content-free, correlated by validated IDs; the only content it can
send is the typed prompt, the final response and the arguments and output of the turn's own tool
calls, of an owner-typed turn in the interactive terminal (other modes refuse the opt-in rather than
leave it unused), as OTLP log records, after an explicit per-kind opt-in, bounded per turn so a turn
full of tool content can never displace its prompt or response, masked on a best-effort basis before
it leaves the process and delivered apart from the content-free logs so that neither can delay or
drop the other. Metrics are low-cardinality by default; a
higher-cardinality label is added only on the operator's explicit opt-in. Metrics derived from child records are
emitted only when those records are complete, and omitted children or unknown prices stay visible
as coverage gaps rather than fabricated totals.
It does not replay stored usage or invent lifecycle events, delivery failure never changes a turn
result, and an unsupported telemetry setting, or a credential that would be silently unused, refuses
startup instead of being ignored. Telemetry credentials are scoped to the destination they were
configured for and are never sent elsewhere, printed, or written to console output, logs or resource
attributes. Robota telemetry settings are not inherited by child processes, except the explicit
handover to a supervised runtime launched by a session command; this is a guarantee about
inheritance, not about hiding them from the same OS user. Because they are removed from
`process.env` at startup, an embedding host that calls `startCli` has its own `process.env` mutated;
a later in-process `startCli` call that sets none of its own reuses the whole settings a previous
call captured, and one that sets any of its own uses only those, in full — settings from different
calls are never mixed key by key, so a destination and the credentials configured for it always come
from the same call, and `ROBOTA_TELEMETRY_ENABLED=0` alone turns export off for every later call
until one sets its own again. None of this is ever written back to `process.env`.

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

### Self-contained bundle

`@robota-sdk/agent-cli` publishes a self-contained bundle for its supported CLI entry points,
independent of sibling packages' publish state: workspace modules those paths need (including
`@robota-sdk/agent-command-workflows` and its DAG runtime) are compiled into `dist`, declared as
`devDependencies` only, so the published package's runtime `dependencies` contain zero `@robota-sdk`
packages — `npm install @robota-sdk/agent-cli` never resolves an `@robota-sdk` sibling. `/workflows`
is always bundled and present; its local runtime uses a fixed base node catalog plus saved instant
nodes, not the larger async catalog available only inside this workspace.

The invariant "agent-cli runtime `dependencies` have zero `@robota-sdk`" is enforced by
`scripts/harness/check-publish-safety.mjs`.

**What a `--session-log` replay executes.** The replay substitutes the MODEL, never the
tools: a recorded `toolCalls` entry is dispatched against the session's live tool set and the real
result is appended to the conversation — a call naming a tool the session does not have produces an
error tool result and the run advances. This dev-only feature (`agent-provider-replay`) is
not bundled in published installs.

### MCP client composition

`@robota-sdk/agent-mcp` owns definition decoding, precedence, admission policy, and the
connection/catalog manager; this package makes that manager reachable from product startup and
supplies the product's MCP client identity there. Every unreadable/corrupt settings layer and every
decode refusal is reported as a problem, never silently dropped; zero resolved definitions is a
normal, silent-diagnostic outcome. A caller-supplied `mcpActivationAdapter` always wins over CLI
composition and skips it entirely.

**Bounded MCP results.** Every discovered tool's result passes a core result-admission
policy before reaching the session's permission, callback, log, or provider path. The default
warning/hard/repository ceiling is 10,000/25,000/500,000 UTF-16 code units; embedding hosts may
configure limits within the repository ceiling. A failed spill produces a secret-free refusal — raw
server output is never substituted back into context. `robota_read_mcp_result` returns at most 4,000
characters per read (less under a host-configured hard limit), with the total size and next offset;
missing or expired references fail with a fixed, payload-free error.

**Client execution authority.** Definitions and settings cannot grant execution authority on
their own: an approved stdio definition without a separately supplied host authority is diagnosed and
never spawned, and a header helper runs only when its exact command line is allowed in the user's own
settings — which a repository cannot write — and, for a repository's definition, the workspace is
trusted. A repository's helper also runs without the user's credential-shaped environment, because
the user allowed the program, not handing their credentials to wherever that repository points it.
Stdio and helper diagnostics never include raw child or SDK errors or anything a helper printed, and
the ordinary executable does not auto-approve package-runner commands.

**Current limitation.** Approval is in-memory and session-scoped per process: a server approved via
`/mcp approve` mid-session is not connected by that already-started session. An embedding host can
supply its own `IMCPActivationApprovalStore` before `robota mcp serve` starts to admit and connect
approved definitions ahead of building the served runtime session.

**External event source opt-in.** The interactive TUI alone can opt into external event injection
from an already-admitted, capability-declaring MCP server via an explicit launch grant. The CLI
trusts the granted server to attest sender identity over its authenticated connection and separately
checks a per-server sender allowlist, but the sender string alone is not proof of identity, so this is
only as trustworthy as the granted server — operators without a verified adapter should leave it off.
Injected events are one-way, bounded, and live only with the session and connection; an admitted
external turn can produce model text but cannot invoke model-generated local or hosted web tools, and
other modes (print, goal, serve, MCP-serve) refuse the flag outright. Repeated connection loss stops
after bounded retries rather than assuming delivery from a dead channel.

### MCP background handoff settings

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

### `--serve` runtime host

`--serve` runs `startRuntimeHost` over the resolved runtime options and the loopback `WsTransport`,
rendering no UI, until SIGTERM. This is the backend the desktop GUI spawns: TUI and GUI are sibling
presentations over the same runtime host, and the GUI never controls the CLI. The composition root
assigns trusted WS driver identities (`app`, `browser`, `remote:ws`) so a turn's persisted usage
surface reflects the launch path rather than a client-provided claim.

Runner failure propagation is explicit in serve mode: `waitForFailure()` returns the first named
nonzero runner outcome without waiting for unrelated runners, and serve mode assigns that exact exit
code. A rejected runner wait assigns exit 1; no runners, all-success, or stop-abandonment leave the
service alive.

### `robota mcp serve`

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

### Memory, screen-reader, theme, prompt-history, and advisor enablement

Each of these product surfaces is **opt-in and resolved by the CLI**, not the library it configures
(library neutrality) — precedence order and defaults for each are non-obvious and stated
here because the reasoning differs between them:

- **Durable memory:** default OFF. Precedence lowest→highest: `settings.json`
  `memory.enabled` → `--memory`/`--no-memory` flag → `ROBOTA_MEMORY` env (**env wins** — a
  machine-level policy a CI runner sets once). Capture + recall are enabled together by one switch;
  scope is repo/project (`<cwd>/.robota/memory/`). A one-time enable notice is printed to stderr on
  first enable; no blocking prompt.
- **Screen-reader mode:** default OFF. Precedence lowest→highest: `settings.json`
  `screenReader` → `ROBOTA_SCREEN_READER`/`INK_SCREEN_READER` env → `--screen-reader`/
  `--no-screen-reader` flag (**flag wins**). This is a deliberate divergence from memory's
  precedence: accessibility must let a per-invocation flag turn the mode ON for one run on a machine
  whose environment has it off (e.g. SSH into a shared host), while memory is a machine-level policy.
  Auto-detection only ever prints one advisory line; it never enables the mode itself — a false
  positive on this feature costs a line of text, while auto-enabling on one would reshape a sighted
  user's interface with no telemetry to ever catch it.
- **Prompt history:** default ON (prompts are already persisted verbatim per session,
  and this is a shell-history analogue). Precedence: `settings.json` `promptHistory: false` ←
  `ROBOTA_PROMPT_HISTORY` env (**env wins**, same direction as memory — a machine-level policy).
  TUI only; print/serve receive no writer.
- **Advisor:** default OFF. Precedence: `settings.json` `advisorModel` ← `--advisor` flag (**flag
  wins**, a per-run choice like the screen-reader flag), and `ROBOTA_DISABLE_ADVISOR` above both as a
  kill switch nothing inside a session can undo — it is how an operator guarantees that conversation
  history is not sent to a second model. Per-vendor consent lives in the user settings file, so it is
  asked once per vendor rather than once per session.
- **Theme registry:** one registry is built per run and handed to both the `/theme`
  command and the renderer, so a listing and a switch can never disagree about which themes exist. A
  run that renders no terminal UI gets no registry and reads no theme file at all. Appearance is
  re-read per call, never captured at startup, so a `/theme list` after an `appearance-settings-patch`
  reports the change that was just made. Theme/plugin ids are constrained to `[A-Za-z0-9._-]` at 24
  characters per segment so a composite id fits the 60-character name bound; a file or plugin outside
  that is skipped with a reason rather than loaded, and the first file to claim an id keeps it.

### Workspace trust and project access

The CLI resolves one host-owned `TWorkspaceProjectAccess`/`WorkspaceTrustService` decision before
composition. Absence is deterministically **Restricted**: only user contribution/settings sources and
the user session store are available, no project memory, and `cwd` alone cannot mint any project
capability. **Trusted** composition derives project sources plus named state facets from the exact
runtime-accepted authority, and is refused when the real CLI working directory is outside the
authority's frozen workspace root. Print mode, `--goal`, and `--serve` fail closed for
`untrusted`/`revoked`/`stale`/`store-unavailable` decisions before provider construction; interactive
startup may continue Restricted with project contributions disabled. All trust diagnostics expose
only state and canonical display path — credentials and project-controlled content are never printed.

### Destination-scoped telemetry headers

Generic OTLP headers go only to signals that use the generic endpoint, never to a signal with its own
endpoint, even though OpenTelemetry would apply them there: a per-signal endpoint may be a different
collector, and generic credentials belong to the generic destination.

### Exact-origin trace propagation

`ROBOTA_TELEMETRY_PROPAGATE_TO` takes exact origins rather than hosts, suffixes or wildcards: a
`traceparent` lets whoever receives it join their own logs to the operator's trace, so each recipient
is named on purpose and a subdomain, port or scheme change is a different recipient. One list covers
providers and MCP HTTP servers alike, because the trust is in the origin, not in the kind of client
that reaches it. An entry must
already be its own origin, so the value compared is exactly the value written.
`ROBOTA_TELEMETRY_PROPAGATE_TO_SUBPROCESSES` is a closed list of classes rather than a pattern,
because each class is a place Robota knows how to hand the trace to — the foreground shell and
command hooks — and every other child (the `!` passthrough, background, managed and scheduled
shells, stdio MCP servers, HTTP, prompt and agent hooks) must never receive it. It is independent of
the origin list, since a child process is not an origin.

### Opt-in metric attributes

`ROBOTA_TELEMETRY_METRIC_ATTRIBUTES` keys its labels `robota.session.id`, `robota.provider.id` and
`robota.model.id` — matching the live trace spans — rather than `session.id` or `gen_ai.*`: a
metric/trace join needs the same key on both sides, the provider id is whatever the host configured
rather than a well-known system, and which model actually answered a request cannot be verified
against which model the request named.

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

### Distribution — Bun single binary

Alongside the npm/Node package, `agent-cli` can be compiled to a standalone executable via Bun.
**Bun is used for build/packaging only — never at runtime**, and no Bun-specific APIs are used; the
Node entry path is retained unconditionally. A literal build target must exactly match the current
host tuple; every unsupported host is refused before compilation, leaving the previously selected
binary generation unchanged.

A subagent turn re-executes the running binary (`process.execPath`) rather than spawning an external
`node` against a worker file, so the compiled binary needs no Node install for any path.

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
robota --serve                       # Headless runtime host
robota mcp serve [--http-token-file <path> [--http-port <port>]]  # MCP server process
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

A provider API failure during a model call must never exit 0. The default `/loop` prompt resolves
from trusted project content before the user's own file and finally a built-in default; project
content is considered only with explicit workspace trust, a present but invalid file fails visibly
rather than falling through, and a file prompt conveys no new permissions.

### CLI update check

The CLI owns its package identity, install guidance, and user-local update-check cache; the framework
provides only reusable version-comparison utilities. Enabled by default only for interactive TUI
startup, rate-limited, and a registry lookup failure never prevents startup. Print/headless
execution never schedules or emits update checks, keeping automation and structured stdout/stderr
contracts deterministic. The CLI may print the install command but must never execute install/update
commands without explicit user confirmation.

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
