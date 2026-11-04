# SPEC.md — @robota-sdk/agent-cli

## Purpose

Interactive terminal AI coding assistant: a React + Ink TUI for running AI agents from the command
line. The CLI is a **thin shell** over `@robota-sdk/agent-framework`'s `InteractiveSession` — all
session lifecycle, slash-command execution, tool orchestration, and abort handling live in the SDK.
The CLI resolves inputs (args, settings, env), assembles a product via `assembleProduct`, and binds
one of several presentations: interactive TUI (default), print/headless (`-p`/`--goal`), the
headless runtime host (`--serve`), an MCP server process (`__PRODUCT_CLI_NAME__ mcp serve`), or an
Agent Client Protocol agent process for editors (`__PRODUCT_CLI_NAME__ acp`).

**Product shell, not a composition root.** `__PRODUCT_CLI_NAME__`'s product identity — branding,
provider surface, presets, capability packs, base command modules, and injected
transports/runners/subagent factory — is declared as DATA in `src/product/product-profile.ts` and
folded by the product-neutral `assembleProduct` (`@robota-sdk/agent-product`). The CLI parses args,
performs user-owned settings/env reads, accepts the host's trusted/restricted project-access
decision, and dispatches print/serve/TUI mode; it no longer hand-wires the assembly. `__PRODUCT_CLI_NAME__` is one
profile among many — an external repo brings its own and reuses the same kernel.

## Boundaries

The CLI does not own, and must not import the internals of: session/persistence adapters (owns none,
must not import `@robota-sdk/agent-session`), tools (assembled by the framework; from
`@robota-sdk/agent-tools` the CLI takes only the OS sandbox — its client, detection and settings — a
host adapter it composes),
permission/hook mechanics (only public types from
`agent-core`), config/context loading, `@file` prompt reference resolution, context-reference
inventory, automatic project memory capture/retrieval/storage, edit-checkpoint capture/storage,
`InteractiveSession` itself, `CommandRegistry`/`ICommand`/`ICommandSource`, background/subagent
lifecycle contracts, transparent-workflow provenance/state vocabulary, baseline workflow storage, or
Ink TUI components/hooks (owned by `@robota-sdk/agent-ui-terminal`). Non-UI behavior exposed through
the CLI is owned below it first unless it is listed as CLI-owned below.

The CLI owns argument parsing and process lifecycle assembly. Local Node use remains independent
of the stock hosted provider's installation; selecting that provider must establish availability
before admission effects, while an injected execution owner remains independently composable.
Hosted execution requires current,
signed admission bound to the task and its root for a separate worker and company broker and a host-owned execution owner
that dispatches the immutable captured invocation inside the admitted worker, projecting only
worker product metadata and broker-issued task access rather than host environment or credentials;
recovery restores verified task files and conversation into a clean worker with current identity and epoch while preserving the logical task root,
rebuilding execution and authority rather than restoring old process memory or authority state;
missing, unavailable or invalid authority or resume state refuses execution without entering local
host adapters; current broker accounting and owner-selected limits remain outside recovered task state,
and stopping retains ownership of execution and teardown. Remote desktop admission additionally binds current company authority to an owner-selected user, workload and session; reconnect withdraws prior access, while trusted operation approval uses a separate operator capability with durable replay protection outside worker state. It owns which transports each mode registers
(the `TransportRegistry` class itself is agent-framework's), provider
composition (selecting an injected `IProviderDefinition`, not implementing providers), concrete local
host adapters (background runner, child-process subagent, Git worktree, settings I/O), package-version
update checks, and the per-mode host-action adapters (`/remote-control`, process exit) through which the session executes a command's host actions.
Remote control is host-owned: it receives only the session capabilities its wire protocol needs, and
promoting a confirmed reconnect winner replaces the registered peer so host shutdown always reaches
the live connection; pairing failure or reconnect-window expiry releases the transport, signaling,
and resume bridge. Stop or device revocation withdraws the affected activation and connection;
late identity, enrollment and reconnect work cannot revive its authority or publish a stale pairing link. The host
identity key devices pin is kept in the host credential store, never in a plain file; a malformed
stored key fails closed rather than being replaced.
The complete public CLI entry and shipped executable share diagnostic, crash and worker-dispatch policy; only the shipped executables also harden their own processes against inspection by programs of the same user, best effort and from when their entry runs, because that changes the whole process, which a host embedding the entry decides for itself. Each invocation owns the product environment inherited by its child processes. The CLI selects every user- and project-scoped path and identity a session needs — storage root,
presets, agent-definition roots, project settings layers, project-state layout, context-discovery
permissions, plugin/skill/command roots, task-context directory, organization policy, keybindings,
and display name — and passes them explicitly to the neutral SDK and framework packages, preserving
explicit local embedding-host scheduling intent without deriving it from settings or plugin claims; they never
infer a path or identity on their own; a second product supplies its own values without inheriting
product-specific. Restricted (untrusted) composition never gains a project settings or contribution source
merely by knowing its path, and an externally supplied trusted authority whose project-state layout
differs from the CLI's is refused rather than read or written. Project-wide tool-permission approvals
persist only through the CLI-selected project-local settings path and the live workspace authority;
an unavailable writer rejects the approval explicitly. Disabled plugins stay disabled across every
command, theme, and discovery surface. The CLI attaches its own setup, diagnostics, and resume
guidance to typed SDK failures — missing provider configuration, invalid settings, or a completed
fork — and supplies the product's diagnostic and resume commands to command modules, which name no
configured executable or product on their own.

Local peer-activity publishing exposes only fixed, content-free activity states for the current
interactive session into a guarded, same-user rendezvous, kept separate from process-liveness checks
(stale or unverified observations read as `unknown`; proven dead announcements are pruned on startup)
and never carrying conversation content or
stored-session identity. The workspace claim published beside it is checked by each reader, which
reads git at the claimed path itself and relates nothing whose contents do not match; it does not
establish that the peer works at that path, because the same OS user is the trust boundary and the
relation grants nothing. Those reads stay local — git in a directory this session did not choose
must never fetch or run repository-configured commands — and the origin travels only as a hash so a
credential in a remote URL never reaches the rendezvous. `session list` shows this presence separately from saved session records
without implying a background supervisor or an attach/restart capability; it includes only
user-owned and currently authorized project records, never transcript content, and corrupt or
unsupported records stay visible rather than being hidden.

A local peer message or file is taken as coming from the session it names only when that session,
asked at its own socket, confirms it is sending exactly that message or file to this receiver, and
one over the device mesh only as coming from the device its handshake proved; anything else is
refused. The same user can reach every socket in the rendezvous, so the name a message states is a
claim, and it decides where an answer goes and whom the turn is attributed to — never what the turn
may do, which the session's ordinary permissions decide as for its own work, wherever the peer runs.

A file from another session or device is kept only with the operator's yes to that file, as an inert
copy in a directory of the sender's under this user's `$PRODUCT_USER_STATE_DIR`, under a name that cannot leave it,
replace anything or follow a link; the conversation is told its name, size and hash, never its
content. Sending is the operator's command for any readable file, and the model's only within the
workspace and away from anything that looks like a secret, because a model steered by what it read
must not reach the credentials beside a project.

A session moves to another session or device only when its holder's operator pushes it; nothing
answers a request for a session. The receiving side takes it only on a grant for that one transfer over
that channel, signed by a device it already knows, and with its own operator's yes; it keeps the
payload aside until it matches the manifest — in memory alone when its stores seal, so no plaintext
copy lands beside them — and saves it without starting it as a record nothing vouches for, since a
peer's word is not the owner's, so its first resume asks. The holder lets go, and ends, only on the
acknowledgement that the session is saved there, so two processes never run one conversation.

A conversation between local peers is bounded, so two agents that always answer cannot message each
other forever: its depth and this session's answers in it are counted from what this session itself
sent and received, never from a count the peer states, and the reply that would cross a limit is not
sent and the operator is told.

Supervised background sessions (`session start --background`) run as independent, same-user
processes behind the same headless trust boundary, each with its own guarded local control endpoint
that survives the launching terminal. The session list reports only content-free activity and
liveness for them — never session content, launch environment, or provider credentials. Unverified
identity, a missing control response, initialization, or shutdown read as `unknown`; `idle` means
only that every session the runtime keeps live is initialized with no pending question and is not
executing, not that another CLI can attach or submit a prompt, so a session no client is on that
still works never lets its runtime read idle. A waiting loop's next eligible time is the earliest
among those sessions, is reported only when observed from the live owner, and does not promise that
a future wake will run.

The global supervised view observes only that guarded inventory, and narrows by owner-reported name,
directory, or linked PR only on a live owner-verified path. It does not join peer or saved-record
identities, show conversation content or project paths in ordinary rows (verified paths appear only
when the viewer groups by directory), treat an exited process as completed, or show stale PR links;
PR URLs never enter ordinary listings or registration records. Starting a session from the view in a
directory not trusted yet asks the person first, and closing the view never stops a supervised
session. A damaged registration is shown as unavailable without hiding healthy
sessions. Each process start registers a fresh generation that its control endpoint requires and
echoes only to a caller that already named it, so a stop, rename, or PR-association request acts
only on the start the caller verified (the one a view row displayed, or the one registered when the
command runs) and fails explicitly when that start, ownership, or completion cannot be established.
A registration that cannot name its start is listed but never controlled, and the generation never
appears in listings. A terminal of the same user on the same host may attach through that endpoint,
naming the process start, to drive the session or to observe it read-only. Attaching is the user's
own decision: it needs an interactive terminal and asks first, on the controlling terminal (never
standard input) or in the session view for the selected row, and holds that yes only for
the process start it named, so a caller without a terminal, a model included, is told the command to
suggest instead. Leaving, `/exit` included, only detaches this terminal and never stops the session;
an attach begun from the view returns to it. It is one more surface
under the session's ordinary co-drive, prompt and session-switching rules, never an operator
approver, so a supervised session still refuses every mesh connection that needs one. Detaching or
crashing ends only that connection: a turn in progress runs on, a prompt no other surface can
answer is denied, and a reader that stops reading is cut off instead of holding the session. Automatic
restart is not offered, so no client's command stops or restarts a supervised session: it serves every
other client, and nothing would start it again.
A workspace's daemon is such a session, at most one per workspace even when starts race, marked so
that a client in that workspace, the desktop app or a terminal attached with `__PRODUCT_CLI_NAME__ --attach`, connects
to the one already running instead of spawning a runtime of its own, so no launch option of the
client's shapes that session. The one exception is Restricted: a daemon reports whether it runs
Restricted, and a Restricted start is never handed one with the project's configuration, because a
person chose Restricted, while a plain start in a folder trusted since is not handed a Restricted one,
because the person who trusted it expects that configuration; a daemon that could not hand over a connection is never left running, and
the lock that keeps racing starts apart is removed only by the start that took it or by the user. The
transport's per-launch authentication token is never exposed through the control endpoint or inventory,
with one exception: a daemon, which receives it only over a pipe its launcher hands it, never through its
environment or command line (a process's initial environment stays readable to every program of the
same user), hands its connection URL to a caller that named its start, so the token leaves only as that URL
and never in human-readable output.

Observability has two independently gated paths. `usage export` is an explicit,
local-only action over the same authorized stores as local usage reporting: its aggregate usage,
verified content-free execution traces, or completion snapshots go only to a caller-named loopback
collector, never including transcript, tool names, session identity, or provider/model labels.
It fails visibly on an incomplete store or collector rejection and never auto-exports. The separate
live telemetry path needs an explicit enable switch, individually selected signals, and an
explicit protocol with a validated destination (OTLP or a local console sink). It uses host-owned
resource and trace identity, never ambient OpenTelemetry identity, trace context or credentials, and
sends a trace's identifiers to a provider only at origins the operator listed exactly, and to a
child process only of a class the operator listed, while traces are exported — the collector's origin and credentials are never implied by that. Its spans
and metrics carry Robota's `agent.*` names unless the operator opts in (`PRODUCT_TELEMETRY_SEMCONV`) to the
still-developing OpenTelemetry GenAI conventions, the only case in which a tool's name — a label, never its arguments or output — appears on
a span or metric. Its spans, metrics
and console output are always content-free, correlated by validated IDs; duration totals remain
measured interval sums when detail is bounded, with invalid evidence explicit and queue selection
distinct from execution. The only content it can
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
attributes. Product telemetry exporter settings, transport admission credentials, and every variable a provider profile or definition names as
its credential, are not inherited by anything the runtime runs on the workspace's behalf, except the
explicit handover to a supervised runtime or subagent worker that needs them; the runtime itself,
including its provider commands, reads them from its startup snapshot, so anything started from that
snapshot instead of `process.env` must pass through the same command-environment filter. A variable an
MCP definition references explicitly is the user's deliberate choice and still resolves. Only a user or
managed settings layer can let commands see a provider credential (`commandEnvAllow`), because a project
layer comes with the repository. Withholding is a guarantee about inheritance: a command the OS sandbox
confines also cannot read the user state the host keeps credentials in, and an unconfined one still
runs as the same OS user. Because they are removed from `process.env` at startup, an embedding host
that calls `startCli` has its own `process.env` mutated, and a later in-process call must pass its
provider credentials in its own `environment` — they are not remembered. Telemetry settings are: a
later call that sets none of its own reuses the whole settings a previous call captured, and one that
sets any of its own uses only those, in full — settings from different calls are never mixed key by
key, so a destination and the credentials configured for it always come from the same call, and
`PRODUCT_TELEMETRY_ENABLED=0` alone turns export off for every later call until one sets its own
again. None of this is ever written back to `process.env`.

Reusable CLI/TUI code must not special-case command module names (e.g. `/agent`); it accepts
`commandModules` and registers them generically with the SDK registry.

### Import Rules

| Source                    | Allowed                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `agent-framework`         | SDK-owned APIs and facades                                                                                              |
| `agent-core`              | Public types + utilities only; internal engine (`ConversationAgent`, `ExecutionService`, `ConversationStore`) forbidden |
| `agent-session`           | Forbidden — the SDK provides its own session/permission types                                                           |
| `agent-tools`             | The OS sandbox only (its client, detection and settings) — the SDK assembles tools internally                           |
| `agent-command`           | Slash-command modules only                                                                                              |
| `agent-subagent-runner`   | Subagent/background runner only                                                                                         |
| `agent-builtin-providers` | Provider definition assembly only                                                                                       |
| `agent-preset`            | Preset id selection + resolution only — `resolvePreset` owns the precedence merge                                       |

## Design decisions

### Browser launch compatibility

Verified pull-request links retain `open` so platform-specific browser launching remains maintained
by a dedicated library. URL trust checks remain Robota's responsibility, separate from the launch
mechanism. Replacing the dependency requires equivalent supported-platform behavior and lower
maintenance cost. A smaller dependency count alone does not justify maintaining operating-system
launch commands here.

### Self-contained bundle

`@robota-sdk/agent-cli` publishes a self-contained bundle for its supported CLI entry points,
independent of sibling packages' publish state: build-time modules those paths need (including the pinned `@robota-sdk/workflows` runtime) are compiled into `dist`, declared as
`devDependencies` only, so the published package's runtime `dependencies` contain zero `@robota-sdk`
packages — `npm install @robota-sdk/agent-cli` never resolves an `@robota-sdk` sibling. `/workflows`
is always bundled and present; its local runtime uses a fixed base node catalog plus saved instant
nodes.

The invariant "agent-cli runtime `dependencies` have zero `@robota-sdk`" is enforced by
`scripts/harness/check-publish-safety.mjs`.

**What a `--session-log` replay executes.** The replay substitutes the MODEL, never the
tools: a recorded `toolCalls` entry is dispatched against the session's live tool set and the real
result is appended to the conversation — a call naming a tool the session does not have produces an
error tool result and the run advances. This dev-only feature (`agent-provider-replay`) is
not bundled in published installs.

### Host credential store

The CLI implements `agent-core`'s credential store port for its own secrets — the remote-control host
key and this device's identity keys: the OS keychain through
the optional `@napi-rs/keyring` binding when it loads and keeps a probe value, else an owner-only file
under `$PRODUCT_USER_STATE_DIR`. The choice is made at first use, told to the operator when it is the file, named
by `/remote-control status`, and recorded: a recorded keychain that stops working fails closed
instead of degrading to the file, because secrets already in the keychain would silently stop being
found. On Linux only the Secret Service counts as a keychain — the binding's kernel-keyring fallback
is memory-only, and a host key lost at reboot changes the identity every device pinned. Messages and
errors name a secret's key, never its value, and carry no cause that could quote it. The recovery
phrase and the one-time code that enrols another device are never stored anywhere: each is shown and
read only on the controlling terminal, opened apart from the session's own input while the session
has handed the terminal over — a byte read through the session's input would reach its composer,
history, transcript and model — and a host without an interactive terminal refuses instead of
reading it from anywhere else. A code typed as a command argument is refused, since the argument is
already in history. The same terminal asks the
operator whether each remote-control connection, a returning trusted device included, may drive the
session; one it admits is the owner typing, with the terminal's approvals, tools and file references.
The session's own prompts are answerable by any attached surface, so a device already
driving could otherwise approve the next, and without an interactive terminal the connection is
refused.

A key that has ever sat in a plain file backups and dotfile sync copy is never carried into the
store: it is replaced by a new key, the file is removed, and the operator is told once that trusted
devices must pair again.

A device that keeps the device-signing key reissues the roster and revocation list before they lapse
while an interactive session runs. The lists expire quickly so that a withheld list cannot pass for a
current one for long, which only holds if their issuer keeps renewing them without waiting for an
operator; the signing key exists for exactly this, and the recovery phrase is never involved. Print,
serve and test runs neither reissue nor open the device mesh, so running the CLI for a single task
never rewrites identity state or answers another device. The mesh opens only when the user settings
turn it on — never a project's, which would let a repository expose this machine to the user's other
devices — and in one session of the device at a time, since each other device keeps one link to it: a
session that stalled long enough for another to take the mesh over closes its own as soon as it notices;
a linked device may do only what the user's settings allow, each file and session it offers put to
the operator at this terminal.

### Keyring custody (`__PRODUCT_CLI_NAME__ secure`)

The keyring file under `$PRODUCT_USER_STATE_DIR/secure` holds only what a locked process may know: the
passphrase- and recovery-wrapped master key and the sealing public key. Every program of the same OS
user can read it, so what protects it is the passphrase, not the mode: the length rule and the refusal
of trivially repetitive input raise the cost of guessing offline at the key-derivation cost, and no
rule makes a weak passphrase safe. The mode, the ownership check and the refusal of links and
non-regular files only keep a file that is not the owner's from being read as the keyring. The file
is the single copy of the keys and is deliberately never backed up, since an old copy would keep an
old passphrase slot working; for the same reason a passphrase change, which wraps the same master key
again, does not revoke a copy of the file someone already took.

Every change to the file is made under one lock beside it and replaces only the keyring it was built
from. Cooperating writers on this machine, and on other machines that share the home directory, are
serialized by the lock, and the one that lost is told the file changed. The lock names its holder's
host, boot and pid namespace: its pid is probed only for a holder on this machine, and any other lock
is aged on the filesystem's clock, so neither another machine's pid nor a step of the wall clock
breaks a fresh one. A holder stalled beyond the stale bound may still be overtaken; it checks the file
and the lock again immediately before it commits and after it reads the result back, which reports
that as `changed` where it can, and the window those checks leave is narrowed, not closed. A write is
atomic, durable and read back, and one that reached the file but could not be confirmed is reported
as most likely in place, never as nothing written.

A passphrase or recovery key is typed at an interactive terminal and comes from nowhere else: not an
argument, the environment, a pipe or a file. Every command that asks for one therefore refuses
unless stdin is a terminal, which is also what turns away a program the model starts through its
shell tool: that process has no controlling terminal and no input. The recovery key is shown once,
on the secret terminal where it is wiped afterwards, and typed back before anything is saved, so a
keyring whose key the person never held is not created. Creating a keyring does not turn secure mode
on. Every conversation store the CLI builds — the workspace composition's and each command's own —
comes from one factory that states how it seals, from one decision: what a later process reads is
sealed with the keyring, and what only its own process reads back (a spilled tool result, the edit
checkpoints of a run that persists no session) with a key made in that process's memory, which seals
nothing else, opens whatever the keyring's lock state and ends with the process; the two are plain
exactly together. A person's `/rewind` reads are refused while the keyring is locked whichever key
sealed the checkpoints, so locked has one meaning for them; what the running turn reads back for
itself is not. Every SDK store constructor requires that decision, and a lint rule refuses a value
import of them anywhere else in the product packages, because only the factory knows the process's
decision: a store built elsewhere could write plaintext beside sealed files. Whether secure mode is
on is one predicate every decision that depends on it reads: the decision is plain unless it is on,
and no process is given a key holder while it is off.

Being the one construction point, the factory is also where a process records that it uses the
stores: the first store it builds (or, for a subagent worker, the grant it binds) creates its
presence under the state root (owner record and mode, removed when the process ends, swept once its
owner is gone), and a `secure migrate` or `secure compact` writes its own marker before it looks. So
whichever comes second sees the first and at least one side refuses, two of them both refuse, and no
lock file is needed; a compaction holds no store, since writers append to the history by path and it
catches them up, so only a migration's marker stops a store. A marker whose owner cannot be checked
counts as running, since a migration that may be running must be treated as one that is; one that
never got the owner record its creation writes at once, and flushes, is a crash's once that moment
is past, and counts as gone. A presence that cannot be created is reported, never fatal, and the
migration's plan says such processes, like those of builds without presence, are invisible to it.
`secure migrate` and `secure compact` unlock before writing anything, since before an unlock the
sealing key is whatever the same-user-writable file holds; they run only in secure mode, at a
terminal, and are never a slash command, a skill or a transport request. A migration marks
nothing it sealed as the owner's on its own, since any program of the same user could have written
the plaintext, only what the person at its end says is theirs. A migration writes a
project only when the trust service says it is trusted now, on a host that can write project state,
through the authority that service mints: the roots records and the history name are same-user
writable, so they are candidates, never authority, and every other root is listed and left alone.

There is no unlock or lock command: unlocked keys live in the memory of the process that uses them,
in one holder that every lock (the user, inactivity, the last client leaving, a locked screen,
suspend) ends and that offers operations with the keys rather than the keys themselves — opening, and
the authorship tag that is the only proof a stored artifact was written by the owner's unlocked
process, since anything sealed to the public key opens — so after a lock no caller still holds one,
and each unlock is announced so what was written while locked can be tagged then; a short-lived
command could only unlock to throw the keys away.
Unlocking is where a swapped stored sealing key is caught. From the first unlock in a process the
holder seals to the key that unlock verified, locked or not and even when the repair of the file
cannot be written; the mismatch is always reported, and the exit status tells a repair that completed
from one that did not. Before that first unlock a locked writer seals to the key the file holds: that
is the design's accepted weakness, caught at the next unlock and visible meanwhile through the
fingerprint. A writer of an append-only store seals one data key per store and reuses it, since a
public-key operation per line is too slow to read back; it starts a new one as soon as the verified
key is not the one the old key was sealed to, so once an unlock has caught a swapped key nothing
written afterwards goes on using a data key sealed to the swapped one. A lock ends every writer's
key too, wiping it, and the next line starts a new one: a writer's key reads every line sealed under
it, so it is key material like the data keys an unlocked holder opens to read, which are wiped with
the keys, even though a locked process reads nothing, not even what it wrote.

### MCP client composition

`@robota-sdk/agent-mcp` owns definition decoding, precedence, admission policy, and the
connection/catalog manager; this package makes that manager reachable from product startup and
supplies the product's MCP client identity there. Every unreadable/corrupt settings layer and every
decode refusal is reported as a problem, never silently dropped, and a server whose tools the model
cannot use because the user must approve it, trust the workspace or sign in is also named to the
model — at the start of an interactive session, the one mode where the user can type the command,
or when a signed-in server refuses a call — in fixed words carrying the
command to suggest, as a terminal command where the run offers no session prompt to type it into, and
nothing the server or its definition sent; zero resolved definitions is a
normal, silent-diagnostic outcome. A caller-supplied `mcpActivationAdapter` always wins over CLI
composition and skips it entirely.

**Bounded MCP results.** Every discovered tool's result passes a core result-admission
policy before reaching the session's permission, callback, log, or provider path. The default
warning/hard/repository ceiling is 10,000/25,000/500,000 UTF-16 code units; embedding hosts may
configure limits within the repository ceiling. A failed spill produces a secret-free refusal — raw
server output is never substituted back into context. `__PRODUCT_MODEL_TOOL_PREFIX__read_mcp_result` returns at most 4,000
characters per read (less under a host-configured hard limit), with the total size and next offset;
missing or expired references fail with a fixed, payload-free error.

**Client execution authority.** Definitions and settings cannot grant execution authority on
their own: an approved stdio definition without a separately supplied host authority is diagnosed and
never spawned, and a header helper runs only when its exact command line is allowed in the user's own
settings — which a repository cannot write — and, for a repository's definition, the workspace is
trusted. A repository's helper also runs without the user's credential-shaped environment, because
the user allowed the program, not handing their credentials to wherever that repository points it.
Stdio and helper diagnostics never include raw child or SDK errors or anything a helper printed, and
the ordinary executable does not auto-approve package-runner commands. An OAuth server's tokens come
only from the user's own per-server sign-in — `__PRODUCT_CLI_NAME__ mcp login` in a terminal or `/mcp login` in a
session — kept owner-only under `$PRODUCT_USER_STATE_DIR`. A sign-in inside a session asks for a pasted
redirect only through the session's own prompt, never the terminal the session owns, and never asks
for a client secret, because what is typed there becomes part of the conversation; a secret is
entered only in a terminal. A server signed in to mid-session connects through the same admission as
at startup, so a sign-in never widens what the user approved. A command suggestion tells the user to run
names the server only when its name is safe to paste into any shell, since a repository chooses that
name and quoting rules differ between shells. The authorization page opens by argv and only for an `https` URL,
and a client secret or pasted redirect is asked for without echo, never read from an argument or a
definition.

**Approvals outlive the process.** The CLI keeps activation decisions in an owner-only file in the
user's storage unless the host supplies its own `IMCPActivationApprovalStore`, and `/mcp approve`
connects the approved server in the running session. A person at a terminal can also add and
approve a server in one step: `__PRODUCT_CLI_NAME__ mcp add`, or the web search question the first
interactive start asks before MCP definitions are resolved, so the choice connects in that session.
No other start asks, and no slash command or model-invocable path adds a server. A decision binds to
the definition's fingerprint and security identity, so a changed definition asks again. A store that cannot be read
reads as no decisions: it can only withhold approval, never grant it. Opted-in distributed skill
content needs separate consent from a known local user, bound to verified instructions, complete
frontmatter, manifest, origin, workspace and URI, and a live activation remains conditional on
that consent and its original source. Supporting bytes are accessible only within that activation's
verified manifest and owning execution; discovery and resource reads confer no other activation.
Observing changed or removed content withdraws consent permanently, so restoring older
bytes or restarting cannot resurrect it, and another workspace cannot reuse or erase the decision.

**External events need a verified grant.** The CLI admits no sender-name grant: a sender name relayed
by an MCP server does not prove who sent an event, and a flag asking for one is refused with that
reason rather than treated as unknown. A grant is the owner's decision at start, from a file of
public configuration only, and a start either opens every grant it was given or fails, naming the
grant and never a configured value: a background session receives its exact grants privately before
it reports ready, and the launcher refuses a readiness that names other grants. Listing a grant shows
its label, principal kind, state and counts, never the principal. Creating or revoking a grant is
the user's act alone: grants are created only by start flags, and `/events` is never offered to the
model. Events arrive over HTTP on a loopback port that the owner's own proxy or tunnel serves at the
grants' public URL; each grant is its own endpoint and audience, so a token for one grant is refused
at another. Which grant labels exist is public, since each grant's protected-resource metadata names
it for token clients; whether a grant is live or revoked is told only to a caller holding a valid
token for it. The endpoint answers with an admission receipt or an empty refusal, never with what a
turn produced, and a background session keeps an owner-only, bounded trail of refusals and
settlements that outlives it, holding no token, content or address.

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
rendering no UI, until its owner requests shutdown; a request made during initialization remains
binding on the acquired host. With `--http-port` it also serves the agent HTTP routes on loopback,
so other applications and services can use the agent without a client library; they reach the
runtime's current primary session and are admitted on loopback by a bearer the operator chooses in
the environment, because a server's clients must outlive a restart that a per-launch token would
not. That bearer is only as safe as the machine boundary, so any other address is bound only as the
same OAuth resource server `mcp serve` offers, whose shared gate alone admits; its turns keep the
host-assigned remote attribution, because the subject allowlist already says who may reach the
session. This is the backend the desktop GUI spawns: TUI and GUI are sibling
presentations over the same runtime host, and the GUI never controls the CLI. The composition root
assigns trusted WS driver identities (`app`, `browser`, `remote:ws`) so a turn's persisted usage
surface reflects the launch path rather than a client-provided claim.

A served runtime that saves its sessions keeps several of them live, and each client connection, an
attached terminal included, is bound to its own: switching or starting a session moves that client
alone, and only that client is told. Leaving a session does not stop its work — a running turn,
queued messages or background tasks go on without the client — but a question it raises while no
driver is on it fails closed: a permission is denied and an ask is cancelled. A change is therefore
refused only when the runtime is stopping, the client's own previous change is still under way, the
session cannot be opened or no room is left for it, or the client is the last driver of a session with
a pending prompt that nobody else could then answer. What belongs to the run rather than to a session — external-event grants and
the supervised name — stays on the session the runtime started with, whichever session a client is on. A token admitted by an
external-event grant remains spent across process restarts until it can no longer verify; the carrier persists only an opaque claim,
never the bearer or its raw identifier.

Runner failure propagation is explicit in serve mode: `waitForFailure()` returns the first named
nonzero runner outcome without waiting for unrelated runners, and serve mode assigns that exact exit
code. A rejected runner wait assigns exit 1; no runners, all-success, or stop-abandonment leave the
service alive.

### `__PRODUCT_CLI_NAME__ acp`

A separate headless process mode: one normally assembled session plus one `agent-transport-acp`
service on stdio, for an editor that launches the process. It uses the caller's working directory,
which `session/new` and `session/load` must name. Unlike the other headless modes it does not exit
at startup for want of workspace trust: the same decision is asked when the editor creates or loads
the session and answered as a protocol error naming the trust command, because an exit before any
protocol traffic reads as a crashed agent. When sessions are stored, the editor may load a stored
session of the same folder in place of the one the process started, which is then shut down; a load
is refused while that session still has work in progress, and for a stored session that would run a
goal, loop or schedule on its own, since the editor sees only the turns it prompts. A Restricted
start a person chose is admitted as it is elsewhere. From entry until shutdown, all product notices
use stderr while stdout is reserved for ACP frames. SIGINT, SIGTERM, stdin close, startup failure
and carrier failure enter one idempotent cleanup path. An editor's `/command` prompt runs as a
transport-origin command on this machine, so the remote command policy applies to it as it does to a
WebSocket client. When the editor offers its file system, Read, Write and Edit read and write through
it behind the same path guard and permission decision, so the agent sees unsaved changes and the
editor holds its edits; Glob and Grep still search the disk and say so, commands stay in the agent's
own sandbox, and the editor's terminals are not used. No WebSocket or TUI transport starts in this mode.

### `__PRODUCT_CLI_NAME__ mcp serve`

A separate headless process mode: one normally assembled session plus one `agent-transport-mcp`
stdio, loopback HTTP (`--http-token-file`) or remote HTTP (`--http-public-url` with the `--oauth-*`
settings) service. It uses the caller's working directory
and the same headless project-access/trust decision as `--serve`, and never prompts for trust over
the protocol stream. From entry until shutdown, all product notices use stderr while stdout is
reserved for MCP frames. SIGINT, SIGTERM, stdin/client close, startup failure, and carrier failure all
enter one idempotent cleanup path; a normal close exits 0, a failure exits nonzero. No WebSocket or
TUI transport starts in this mode.

The HTTP token-file variant creates the token file exclusively with owner-only permissions, never
puts the bearer in command arguments or stdout, and removes its own token file during shutdown; it
refuses a relative token path or an existing file. That bearer is only as safe as the machine
boundary, so the process binds a non-loopback address only as a remote resource server, whose
access tokens are verified against the configured issuer, and never with the token file. Its
refusal audit goes to stderr as a reason and an address class, never token text.

### Memory, screen-reader, theme, prompt-history, and advisor enablement

Each of these product surfaces is **opt-in and resolved by the CLI**, not the library it configures
(library neutrality) — precedence order and defaults for each are non-obvious and stated
here because the reasoning differs between them:

- **Durable memory:** default OFF. Precedence lowest→highest: `settings.json`
  `memory.enabled` → `--memory`/`--no-memory` flag → `PRODUCT_MEMORY` env (**env wins** — a
  machine-level policy a CI runner sets once). Capture + recall are enabled together by one switch;
  scope is repo/project (`$PRODUCT_PROJECT_STATE_DIR/memory/`), because project memory is shared through the
  repository, so it never moves to a per-user store: on a host that cannot write under the project
  safely, memory stays off and says why once. A one-time enable notice is printed to stderr on first
  enable; no blocking prompt.
- **Screen-reader mode:** default OFF. Precedence lowest→highest: `settings.json`
  `screenReader` → `PRODUCT_SCREEN_READER`/`INK_SCREEN_READER` env → `--screen-reader`/
  `--no-screen-reader` flag (**flag wins**). This is a deliberate divergence from memory's
  precedence: accessibility must let a per-invocation flag turn the mode ON for one run on a machine
  whose environment has it off (e.g. SSH into a shared host), while memory is a machine-level policy.
  Auto-detection only ever prints one advisory line; it never enables the mode itself — a false
  positive on this feature costs a line of text, while auto-enabling on one would reshape a sighted
  user's interface with no telemetry to ever catch it.
- **Prompt history:** default ON (prompts are already persisted verbatim per session,
  and this is a shell-history analogue). Precedence: `settings.json` `promptHistory: false` ←
  `PRODUCT_PROMPT_HISTORY` env (**env wins**, same direction as memory — a machine-level policy).
  TUI only; print/serve receive no writer. A run with `--no-session-persistence` writes none,
  whatever the setting or the environment says.
- **Advisor:** default OFF. Precedence: `settings.json` `advisorModel` ← `--advisor` flag (**flag
  wins**, a per-run choice like the screen-reader flag), and `PRODUCT_DISABLE_ADVISOR` above both as a
  kill switch nothing inside a session can undo — it is how an operator guarantees that conversation
  history is not sent to a second model. Per-destination consent lives in the user settings file, so
  it is asked once per destination rather than once per session.
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
authority's frozen workspace root. Every session it builds gets an edit checkpoint store, and
sessions that can run turns at the same time never share one, because a store holds its session's
turn in progress. On a host that cannot prove a project write stays under that root,
nothing is written under the project: the workspace's sessions, which are the user's own, are kept in
the user session store and found there by their working directory, so they are still saved and
resumable, while project memory, which belongs to the repository, and edit checkpoints, whose restore
writes the project's files back, are not composed; `/rewind` then says which of trust or the host
stands in the way. Print mode,
`--goal`, and `--serve` fail closed for `untrusted`/`revoked`/`stale`/`store-unavailable` decisions
before provider construction, because no one is there to ask, unless the run was asked to start
Restricted (safe mode, or a run a person chose to start Restricted) or is `--serve --open` at a TTY,
where someone is: it asks the same trust/Restricted/quit question there instead of refusing; an
interactive start asks the person before the project is composed and continues Restricted when they
decline, because a Restricted session no one mentioned hides why the project's own configuration is
missing.
All trust diagnostics expose only state and canonical display path — credentials and
project-controlled content are never printed.

### `--no-session-persistence`

The flag promises that a run leaves no conversation-derived data on disk once it exits, apart from
durable memory: memory is a store the owner turned on to keep across runs, so the flag leaves that
choice alone. The session record is only one of the stores that would keep the conversation, so the
flag turns off every store the run could otherwise keep — the session record, prompt history and
subagent transcripts — not the session store alone. Edit checkpoints are the exception: `/rewind`
needs the pre-images of the run's own edits, so with the flag they keep working for the run but move
out of the project into an owner-only per-process directory of the state root, removed when the run
ends.

The working data a live feature needs — spilled tool results and the `/editor` buffer, and with the
flag those checkpoints — lives in owner-only per-process directories of the state root, never the
shared temporary directory: spilled results and the composed message are conversation content whether
or not the flag is set. Whatever ends a run — an exit, a hangup, an interrupt, a termination
request or a crash the crash policy rethrows — removes them without changing how the process ends; a
run killed outright leaves its directory, and the next start removes those whose recorded owner can no
longer be alive, by the rule `@robota-sdk/agent-core` states for process-scoped directories.

### Destination-scoped telemetry headers

Generic OTLP headers go only to signals that use the generic endpoint, never to a signal with its own
endpoint, even though OpenTelemetry would apply them there: a per-signal endpoint may be a different
collector, and generic credentials belong to the generic destination.

### Exact-origin trace propagation

`PRODUCT_TELEMETRY_PROPAGATE_TO` takes exact origins rather than hosts, suffixes or wildcards: a
`traceparent` lets whoever receives it join their own logs to the operator's trace, so each recipient
is named on purpose and a subdomain, port or scheme change is a different recipient. One list covers
providers and MCP HTTP servers alike, because the trust is in the origin, not in the kind of client
that reaches it. An entry must
already be its own origin, so the value compared is exactly the value written.
`PRODUCT_TELEMETRY_PROPAGATE_TO_SUBPROCESSES` is a closed list of classes rather than a pattern,
because each class is a supported child target for trace handoff — the foreground shell and
command hooks — and every other child (the `!` passthrough, background, managed and scheduled
shells, stdio MCP servers, HTTP, prompt and agent hooks) must never receive it. It is independent of
the origin list, since a child process is not an origin.

### Opt-in metric attributes

`PRODUCT_TELEMETRY_METRIC_ATTRIBUTES` keys its labels `agent.session.id`, `agent.provider.id` and
`agent.model.id` — matching the live trace spans' default naming — rather than `session.id` or `gen_ai.*`: a
metric/trace join needs the same key on both sides, the provider id is whatever the host configured
rather than a well-known system, and which model actually answered a request cannot be verified
against which model the request named. Under the GenAI naming opt-in, the `gen_ai.*` metrics carry the
requested model as those conventions require whatever this opt-in says, the `session` key stamps their
points like any other, and the provider and model keys label their inference points too (the model only
under `gen_ai/dup`, since `gen_ai` already names it), so an operator's provider split survives the
`agent.*` token counters that `gen_ai` drops.

### Deep links (`__PRODUCT_CLI_NAME__ open`)

Decided BEFORE argument parsing and before any workspace composition, so a malformed or untrusted
link is named as such rather than reported as a missing terminal. The grammar is closed: verb
`__PRODUCT_PROTOCOL_SCHEME__://open` (case-insensitive) and exactly four keys (`v` required as `1`, `prompt`, `cwd`,
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
constructor behavior — those come from the injected `IProviderDefinition` records, including the
product's model-native web search default, which applies wherever a definition declares native web
search for the profile being built and yields to a profile that sets `nativeWebTools`. The product's definition set is built in one
place for the parent session and the child-process subagent worker alike; routing it through
`startCli({ providerDefinitions })` would mark it caller-supplied and make subagents non-reproducible. The
profile key
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
binary generation unchanged. Native builds require the complete provider capability at build time
and embed it, so hosted execution depends neither on adjacent packages nor on what lies where the
executable starts: it reads no `bunfig.toml`, `.env`, `tsconfig.json` or `package.json` there, because a
cloned repository's preload or `.env` would otherwise run code or rewrite the environment before
workspace trust is decided. Bun's runtime variables (`BUN_OPTIONS`, `BUN_BE_BUN`) still let whoever sets
the process environment run other code through the executable, as `NODE_OPTIONS` does for the npm
package; that is the same OS user, and no build switch removes them.

A subagent turn re-executes the running binary (`process.execPath`) rather than spawning an external
`node` against a worker file, so the compiled binary needs no Node install for any path.

## User-facing contract

The consumer of `agent-cli` is the person at the terminal (or the script invoking it); the items below
are what they can rely on.

### Modes and flags

```bash
__PRODUCT_CLI_NAME__                               # Interactive TUI
__PRODUCT_CLI_NAME__ init                          # Initialize project (AGENTS.md + $PRODUCT_PROJECT_STATE_DIR/settings.json)
__PRODUCT_CLI_NAME__ open '<__PRODUCT_PROTOCOL_SCHEME__://open?v=1...>' # Open a deep link into a trusted directory
__PRODUCT_CLI_NAME__ trust status | --yes | revoke --yes   # Inspect/grant/revoke workspace trust
__PRODUCT_CLI_NAME__ doctor [--repair <id> -y]     # Diagnose configuration/runtime readiness (aliases: checkup, diagnose)
__PRODUCT_CLI_NAME__ usage [--period 30d] [--timezone UTC] [--format json]  # Local personal usage summary
__PRODUCT_CLI_NAME__ secure setup | status | verify | change-passphrase  # Keyring for secure conversations; secrets are typed at the terminal only
__PRODUCT_CLI_NAME__ eval ./my-eval.mjs            # Run an evals-as-code definition; exit 1 on a metric breach
__PRODUCT_CLI_NAME__ -p "prompt"                   # Print mode (one-shot, headless)
__PRODUCT_CLI_NAME__ --serve                       # Headless runtime host
__PRODUCT_CLI_NAME__ mcp serve [--http-token-file <path> | --http-public-url <https> --oauth-*] [--http-port <port>]  # MCP server process
__PRODUCT_CLI_NAME__ acp                           # Agent Client Protocol agent process, for editors
__PRODUCT_CLI_NAME__ -c | --continue                       # Continue the most recent session for this cwd
__PRODUCT_CLI_NAME__ -r <id> | --resume [id]               # Resume a session by id/name, or show a picker
__PRODUCT_CLI_NAME__ -c --fork-session                     # Fork from the last session (new id, restored context)
__PRODUCT_CLI_NAME__ --name <name> | --reset | --model <model> | --language <lang>
__PRODUCT_CLI_NAME__ --permission-mode <plan|default|acceptEdits|bypassPermissions>
__PRODUCT_CLI_NAME__ --max-turns <n> | --goal <objective> [--goal-max-iterations <n>]
__PRODUCT_CLI_NAME__ --allowed-tools <list> | --denied-tools <list>
__PRODUCT_CLI_NAME__ --json-schema <schema> | --output-format <text|json|stream-json>
__PRODUCT_CLI_NAME__ --system-prompt <text> | --append-system-prompt <text>
__PRODUCT_CLI_NAME__ --check-update | --disable-update-check | --version
```

`--output-style <id>` selects the provider-neutral response style (flag > persisted `outputStyle`
setting > `default`); `--effort` (or `PRODUCT_EFFORT`/settings/preset) selects the model-effort tier
from `auto`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` — invalid values are terminal
startup errors.

### Session resolution

`--continue`/`-c` resumes the most recent session for the cwd (reusing its id) that is the owner's,
and does not go on past a newer one that is not without a person's word; `--resume [id]` resumes an
explicit id or name, or shows a picker when omitted. What an unverified record says of itself — its
name, its time — never chooses what runs, so such a record never answers for a name, and a text that
is both a verified record's name and the id of a record not verified as the owner's is refused as
ambiguous. `--fork-session` (combined with either) creates a fresh id while restoring the resumed
context, leaving the original file untouched. `-c` with no prior session for the cwd starts a new
one — identical in TUI and print mode. Print mode requires an explicit `-r <id|name>` (no
interactive picker) and rejects `--no-session-persistence` combined with `-c`/`-r`. A sealed session
whose keys are locked is in no picker and is not what `-c` picks, because there is no record to
show; so `-r` names the lock for an id, and counts the locked sessions for a name it cannot match,
instead of reporting the session missing, and every surface that lists or picks sessions says how
many it left out whenever some are locked — the latest readable session may not be the latest one —
while `usage export` refuses rather than send a partial snapshot. A served rename or delete of a
locked session names the lock instead of calling it unknown. Resuming a record that is there but
cannot be read (locked, corrupt, or from a build this one does not read) is refused rather than
started empty under its id; one not verified as the owner's is resumed only when a person, shown
fixed text that carries nothing the record says, accepts exactly the bytes they were shown, and is
refused wherever no one can be asked. Accepting raises nothing until the session has restored from
those bytes, so a resume that does not go ahead leaves them as they were. The CLI says so before any
surface starts, so the terminal UI never meets it in its first render.

### Destructive actions

Every destructive CLI flag (e.g. `--reset`) follows one contract: nothing is deleted without consent.
On a TTY without `--yes` it prompts `Delete <path>? [y/N]`; on a non-TTY without `--yes` it refuses and
names the flag; `--yes`, or `CI=true` for `__PRODUCT_CLI_NAME__ init`'s confirmations, skips the prompt. `--yes`
means "non-interactive with documented defaults", not "answer yes to everything" — `__PRODUCT_CLI_NAME__ init` never
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

- `__PRODUCT_CLI_NAME__ trust status` previews the project sources that trusting the current workspace would enable,
  using metadata only: it never follows links, never reads file content and never prints credentials
  or project-controlled content. Where safe metadata is unavailable, the plain-text preview and the
  TUI's own interactive ask list the candidate with its metadata marked unavailable; `--json` (and the
  desktop trust dialog that reads it) omits that candidate instead, since a state it could not
  determine says nothing worth showing there.

## Known limitations

- Korean IME on macOS Terminal.app can crash the terminal (SIGSEGV) during IME composition; use
  iTerm2, or rely on the CLI's blank-line workaround that stabilizes cursor position.
- The keyring commands check that a secret is typed at an interactive terminal, not that a person
  types it: a program that allocates a pseudo-terminal of its own and types into it is outside that
  guard.
- The Bun single-binary distribution's subagent-spawns-itself path (`process.execPath`) has been
  measured for the worker IPC handshake on Linux; a full end-to-end subagent turn from the compiled
  binary (which additionally needs a model provider in the child) has not been run.
