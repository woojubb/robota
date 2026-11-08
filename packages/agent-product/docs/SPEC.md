# agent-product Specification

## Purpose

Owns the **product-assembly kernel**: the `IProductProfile` declarative product object, the
`IAssembledProduct` runtime-materials result, and the single composition function
`assembleProduct`. `assembleProduct(profile)` is a **pure, deterministic, IO-free fold** over
`IProductProfile` data with **zero product-specific branching** — the composition mechanism a
third party imports to build their own product on the published runtime. Product identity comes from
the host's profile. The root entry is platform-neutral: it runs in a browser, a Web Worker, Node, Deno and
Bun, and has no Node adapter; what needs a Node host is on the Node-only subpaths `preset/node`,
`command/node` and `coding`.

The package also holds the pieces a product is assembled from, one subpath each: `capability-pack`,
`preset`, `command` and `coding`. They live in one package to save a manifest, a build and a release
receipt each, and stay separate subpaths so that importing one never loads another.

## The pure-fold property

This package is carved out of the "no shared product factory" rule not on "profile-driven" alone —
a profile-driven function could still accrete per-product branches and become a de-facto shared
factory — but on a stronger property: `assembleProduct` reads only its argument, calls only pure
sub-folds and the framework's runtime-construction seam, and returns assembled materials. That
boundary has three parts:

1. **Dependency-graph neutrality** — declares no concrete transport/UI/CLI dependency.
2. **Purity / no I/O** — no filesystem, `process.env`, or settings read anywhere in this package;
   all resolved data is fed in from the shell that calls it.
3. **No product-name conditionals** — no branch on a profile's identity in any form (equality,
   switch, string-matching, or a lookup table keyed by identity). Reading the identity as data
   stays legal; branching on it does not.

## Contract

- Runtime construction is delegated entirely to `agent-framework`'s runtime-construction seam —
  this package does not re-implement it, so there is exactly one runtime-construction source of
  truth.
- Provider resolution order: an injected override wins, else a provider is constructed from
  `profile.providerSettings` via `agent-core`'s pure provider factory, else no provider is
  constructed and the caller must supply one when building the runtime. An unknown provider name
  throws, naming the supported types, rather than silently producing no provider.
- Preset resolution uses an instance-scoped registry built over built-ins plus the profile's
  presets — unless the profile supplies its own registry, which wins outright. This lets a shell
  that must resolve a preset before it can even construct the profile (because the preset carries
  values the profile is built from) reuse that same registry here rather than maintaining two
  equivalent-but-separate ones.
- Capability-pack merge precedence is base command modules < accepted packs in profile order;
  duplicate pack ids are rejected atomically before folding. Accepted packs, rejected
  capabilities, and rejected packs are all reported losslessly rather than only the accepted set.
- Product wording and model-facing identifiers are plain data the fold passes through unmodified
  when the shell hasn't supplied its own — they are never interpreted or branched on, and two
  assembled products in one process keep separate values.
- Every field of `IProductProfile` is exhaustively classified by a fold policy; adding a new
  profile field fails compilation until it is classified and behaviorally covered.

## Boundaries

- Does not import a concrete transport, TUI, remote-control, or CLI — those stay wired in the
  shell and are injected into the profile as data.
- Does not read settings, files, or env — the shell resolves those and passes in already-resolved
  data.
- Does not read provider settings, but does construct the provider from already-resolved config.
- Does not mutate any module-level preset registry global — it builds or adopts an
  instance-scoped registry only, so two calls never cross-contaminate.
- The subpaths are isolated: one reaches another only through the entry its former package
  depended on, and no platform-neutral entry reaches a Node-only subpath. An in-package test pins
  both.

## Error handling

`assembleProduct` throws no error classes of its own; preset resolution throws a plain `Error` on
an unknown preset id.

## capability-pack

### Purpose

Owns the **additive capability-bundle contract** for the Robota SDK: the `ICapabilityPack`
definition shape, the `IMergedCapabilities` result shape, and the pure `mergeCapabilityPacks`
merger. A capability pack is the _additive_ composition unit — a plain data record of named
capability buckets (command modules, tools, subagents) a consumer brings on top of a product's
base command modules. It is the additive analog of the `preset` subpath: where a preset
dials **behavior** (subtractive tool/command selection, persona, permission posture), a pack
contributes **capability** (new tools, command modules, subagents). This package produces contract
types and one pure fold; it performs no session assembly and no IO.

### Boundaries

- Does **not** assemble sessions, construct providers, resolve presets, or build runtimes — those
  belong to `agent-framework` (assembly/runtime seam) and the package root (the assembler that
  consumes this merger).
- Does **not** read settings, files, or env — it is a contract + pure function package.
- Does **not** execute contributed code. `mergeCapabilityPacks` folds pack contributions purely;
  any contributed command/tool runs only through the existing permission-gated runtime at call
  time, never by the mere act of being merged.
- Does **not** re-export `agent-framework` or `agent-core` (no pass-through re-export). It depends
  on them for contract types only.

### Model-facing / declarative-vs-executable note

A capability pack is **not declarative JSON**. Unlike a serialized manifest that a host can
enumerate without running contributor code, a pack carries **executable code objects** — command
modules with handlers, tool instances with `execute` functions, and subagent definitions. It is an
in-process composition argument handed to the assembler, not a serialized declaration, so
"no function across a serialization boundary" properties that would apply to a serialized manifest
do not apply here. The safety property instead rests on three invariants:

1. **Packs are opt-in** — a pack contributes only when a product profile lists it; a pack never
   self-activates.
2. **The merge is pure** — `mergeCapabilityPacks` executes none of the contributed code; it only
   folds declarations into a superset.
3. **Contributed code runs only through the permission-gated runtime** at call time.

### Merge semantics — conflict resolution

`mergeCapabilityPacks` is a pure, deterministic, IO-free fold — the additive analog of
`resolvePreset`.

- **Precedence:** base command modules claim the namespace first, then packs in profile order.
  First registration wins. A preset's enable/disable delta is applied _after_ this merge by the
  product shell — the merge widens, the preset delta filters; they compose rather than conflict.
- **Pack identity:** pack ids are claimed before any capability bucket is folded. A later
  duplicate pack id is rejected atomically — reported once, contributes nothing across every
  bucket, and does not stop a following unique pack.
- **Rejection channel:** a capability whose id is already claimed (by the base or by an earlier
  pack) is dropped from the merged result and reported in a separate rejection channel with its
  contributing pack id, kind, id, and reason — never as a thrown exception.
- **Purity:** the merger reads only its arguments and returns fresh arrays; it mutates neither the
  base command modules nor any pack.
- **Total field policy:** every public pack field is classified (consumed, surfaced,
  consumed-and-surfaced, or explicitly rejected) so that adding a new field to the pack shape fails
  compilation until the fold classifies it.

### Non-goals

- The subpath imports no other subpath and no repository package beyond `agent-core` (tool
  contract) and `agent-framework` (command module / agent definition contracts), and neither is
  re-exported.

## preset

### Scope

Owns the preset contract for the Robota SDK: the preset definition shape, the resolved
framework-option subset a preset resolves into, a small set of built-in presets, and an
instance-scoped registry resolver. A preset is a named, pre-tuned bundle of framework option
overrides (persona, model/effort, permission posture, command-module selection, execution
capabilities, autonomy). This package produces option data only; it performs no session assembly.

It also owns the provider-neutral output-style catalog: built-in style definitions, Markdown style
file parsing, and an instance-scoped registry with built-in-beats-external precedence.

The `preset` entry is platform-neutral: it runs in a browser, a Web Worker, Node, Deno and Bun. The one
host read, listing a directory of preset files, is on `preset/node`.

### Boundaries

- Does **not** assemble sessions, synthesize system prompts, apply permission modes, or select
  command modules — those belong to the assembly package, the execution-capability packages, and
  the command-module package respectively.
- Does **not** parse CLI flags, read settings, or render active-preset UI.
- Does **not** re-export the framework package it depends on; it consumes the framework's option
  types as the single source of truth for the option shape rather than redefining them.
- Imports no other subpath and only one repository package, `agent-framework`, for option types.

Preset resolution merges three layers by precedence (low to high): the preset's own options, then
CLI overrides, then explicit overrides. Later layers win; values left `undefined` are skipped. The
identity triple (id/title/description) is stripped before merging, so a preset with no overrides at
all resolves to the caller's overrides unchanged — a no-regression guarantee for the baseline
preset.

### Contract

#### Command-module selection

A preset (or an override layer) may narrow the default command set with an allow-list and a
deny-list of module names. The deny-list is applied after the allow-list, so deny always wins over
allow. Both lists match against a module's canonical long-form name, not its short slash-command
name. This package only produces these field values — the actual filtering happens downstream. A
configured name that matches no known module is surfaced as a non-fatal notice to the caller rather
than being silently dropped.

#### External preset loading

User-authored presets are loaded at runtime from a JSON file per preset, handed to the package as
named files by the product shell; `preset/node` lists a directory of them. The package reads no file
on its own and does not choose the user's home, a product-specific storage root, or a default agent
name. Each file is parsed and validated with a manual type-guard (no schema
library); the untrusted effort field is validated through the framework's shared parser so external
presets accept the same effort vocabulary as built-ins. Loading applies a conflict policy and
returns the survivors as a value — it registers nothing globally, so a second load in the same
process does not see a previous load's presets, and two products sharing a process each see only
their own.

Conflict policy:

- Built-ins always win — an external preset whose id collides with a built-in is rejected, and
  built-in ids can never be overridden. A duplicate id among external presets is also rejected,
  keeping the first.
- Per-file isolation — a read, parse or validation failure is recorded against its file and that file
  is skipped; the rest still load. A missing directory yields an empty result, never an error.

The output-style registry applies the same shape of precedence for style files: built-in styles win
on id collision, and a per-file parse or validation failure is isolated rather than aborting the
whole load.

#### Removed: `defaultTrustLevel`

The preset contract used to carry a `defaultTrustLevel` field that nothing read. It was removed by
owner decision rather than wired up, because a preset already states its trust/permission posture
three other ways (permission mode, default permission mode, and autonomy), and resolution already
promotes the latter two into the first — a fourth spelling would have been a second answer to a
question that already had one. The trust axis itself is untouched elsewhere in the system; only the
preset's own redundant copy of it is gone.

#### Built-in presets

The built-ins span the autonomy spectrum deliberately: a neutral baseline that applies no
overrides at all (the no-op reference point), an opinionated proactive/self-verifying builder
posture, a deliberate ask-first/plan-first counterpart for careful review work, and a thin
literal-execution posture for predictable scripted use. Each shipped persona carries portable
behavioural content only (e.g. proactivity, scope discipline, self-verification, non-sycophantic
honesty) — none of them embed runtime/environment content such as working directory, tool schemas,
product identity, dates, or permission text, since that is the assembling framework's
responsibility to inject.

### Error Taxonomy

Looking up an unknown preset id throws a plain `Error` naming the id and listing the available
ids. No custom error classes are defined for this package's single failure mode.

## command

### Purpose

Consolidated command module for the configured SDK CLI. Provides all slash-command implementations on one
subpath. Plugin commands consume an injected `ICommandPluginAdapter`; human
withdrawal controls remain reachable during active execution without activating new contributions,
while the CLI owns the concrete adapter and plugin source loader.

### Non-goals / Boundaries

- Transport layer (WebSocket, TUI, headless) — owned by `agent-transport`.
- CLI entry point and argument parsing — owned by `agent-cli`.
- Agent runtime and session management — owned by `agent-core` / `agent-framework`.
- Command registration contracts (`ICommandModule`, `ICommandSource`, `ISystemCommand`) — defined in
  `agent-framework`.
- Plugin infrastructure (installer, loader, marketplace client) — defined in `agent-framework` and
  composed by `agent-cli`.
- The subpath imports only the `preset` entry of this package and has no circular dependencies.

### Contract and guarantees

**Assembly (`createDefaultCommandModules`).** Allow-then-deny module filtering is delegated to
`agent-framework`'s `selectCommandModules` — the single filter implementation, never reimplemented
here. Any `enabled`/`disabled` module name that matched no built module (a short form, or a typo) is
returned as `unknownModuleNames` data rather than silently dropped, so the host can surface a
non-fatal notice instead of failing closed or pretending the name took effect. Skills discovery
consumes only the explicit contribution sources and ordered skill/command roots it is given; it never
selects product directories or reconstructs project reads from `cwd`.

**Host commands (`command/node`).** A command whose whole purpose is the host — `/shell` and `/editor` hand the
user's terminal to a child process — lives on `@robota-sdk/agent-product/command/node`, and so do the adapters
a command takes by injection. The `command` entry is platform-neutral (it runs in a browser, a Web Worker,
Node, Deno and Bun) and holds no host default: the
default assembly omits the commands whose whole purpose is the host, which a Node product adds beside
it, so a host that is not Node never lists a command it cannot run. A command that needs a host
capability for part of its work (`/doctor` its probes, `/keybindings` its editor, `/git` its process,
`/user-local` its file system) takes that capability as a port; without it the command is still listed and says it is unavailable
there, rather than failing or claiming work it did not do.

**User-local commands.** The direct command and the assembled slash command share the host-supplied
storage root for inspection and memory operations; neither chooses a home directory itself when the
host omits that root, and memory curation preserves the user's control across authenticated attached
surfaces subject to host command policy, without granting the model destructive curation authority.

**Demand-switch sessions.** The `agent` and `schedule` command modules declare
`sessionRequirements: ['runtime']`: composing either module makes the session layer enable the
agent runtime. This is a demand switch, not a gate — it does not assume the runtime is available
beforehand.

**`output-style`.** Operator-only, and uses only the injected provider-neutral style registry; it
never reads style files itself.

**`/doctor` (read-only diagnostics).** Every check carries a stable id, a status in
`ok | warn | fail | not-configured | not-probed`, the exact path it concerns, and a cause built from
owner-reported facts — never a default value substituted for one that could not be determined. `fail`
is the only status that raises the report's exit code. `not-configured` names an absent optional
capability out loud instead of treating it as healthy. `not-probed` is a closed, enumerated list of
probes the doctor deliberately does not run; an unexpected inability to probe is `warn` with its
reason, not `not-probed` — that state must never read as a pass. Every rendered string passes through
one redaction boundary that masks known secret values, URL userinfo, bearer tokens, and vendor-key
shapes, fed by a single collector of literal and env-referenced credentials — inspection APIs
themselves return facts, never raw file content. Repair is a closed, product-neutral allowlist; a
repair is planned, confirmed through the caller's prompt, then **re-planned immediately before
writing** and refused if the id is unknown, the state is not repairable, the state changed since
planning, or the check is already clean — in every refusal case, nothing is written. The doctor
performs no write of its own outside an explicit, confirmed repair, and every probe and writer it runs
through is the host's (`IDoctorDeps`): on a host that supplies none, `/doctor` says it is unavailable
instead of reporting checks it never ran.
Report titles, product-readiness summaries, repair command text, and provider/trust remediation
are host-selected display vocabulary. Without host wording, diagnostics stay product-neutral. The
same report data and repair decisions are used by slash and shell routes.

**`/keybindings`.** The command knows nothing about the keybindings schema, defaults, contexts,
watcher, or TUI implementation — it only asks an injected capability port to ensure the user document
and an injected opener to show the returned path in the user's editor; without the opener it answers
that no editor can be opened here and creates no file. Key bindings belong to the terminal the user sits at, so that
terminal runs the command: one attached to a workspace daemon runs it in its own process, never on
the daemon, and does so even without the port, so a missing port cannot send it there. Without that
port the command still exists and answers that key bindings belong to the configured CLI terminal, so a host
without a terminal never replies "Unknown command".

**`/git` (host-only, blocking).** Every verb runs through an injected process port, absent on a host
that has none (then `/git` says it is unavailable), whose production implementation is argv-only (`execFile`, `shell: false`, so no token is ever parsed as shell syntax),
closes stdin immediately, caps output, bounds the child by a timeout, and never throws — every way a
run can end is a typed outcome (`exited` with the exit code as data, or `failed` with a closed set of
reasons). The child environment strips only the variables git exports into hooks that redirect it to
another repository, and deliberately preserves identity and configuration variables so a commit stays
attributed to the user. `diff` accepts a closed grammar only (bare, `--staged`, a single revision, or a
range, each optionally followed by paths); every revision is verified to exist before any diff runs,
and anything outside the grammar is refused rather than passed through. `commit` only ever commits the
already-staged set — never `-a`, never an implicit `add` — and always confirms the message and the
exact file list before writing; with no interactive surface available, that reads as a cancellation,
never a silent guess. Known limit: the slash-command tokenizer has no quoting, so a path containing a
space cannot be expressed, and the inline subject cannot carry a body; the timeout only bounds the
direct git child, not a hook's grandchildren still holding the output pipes open.

**`/mcp`.** Reads and requests approve/reject/revoke, sign-in and sign-out through an injected host
adapter; it never constructs or connects an MCP client itself, and only hands the tools a sign-in
connected to the session. Every change it makes widens or withdraws trust or a credential, so those
stay user-only; a client secret is never asked for in a session, since what is typed there becomes
part of the conversation. The model may read status only, and its view is rebuilt from fixed words —
a server name only when it is safe to show, the states, and the command the user should run — never
a definition's reason text, provenance, fingerprint or endpoint, because those are text a repository
wrote or can carry a credential.

**`/events`.** Lists and revokes the session's external-event grants through an injected host
adapter and never creates one. It is user-only as a whole: a grant is the owner's standing decision to
let someone outside put turns into the session, and withdrawing it is the owner's call too.

**`/peers` activity.** The command renders the host's fixed activity observation separately
from process liveness. An absent, expired, or unverified observation is shown as unknown; the command
does not inspect another session's conversation or infer activity from a stored transcript.

**`/effort`.** `auto` is preserved as the session's own selection rather than being resolved to and
persisted as a concrete tier — a report of the effective tier is derived for display, but the stored
selection stays `auto`.

**`/handoff`.** States what will not travel — uncommitted changes, running subprocesses, and the
provider credential, which is never transferred — before it asks, and a dismissed or absent
confirmation is treated as a decline, never a default yes. Every outcome states where the session now
lives.

**`/fork`.** A fork is a copy: work done in it never reaches the parent session and never merges back;
following it while running or continuing it later never merges the conversations. It runs in an
isolated worktree by default so filesystem work cannot collide with the parent's working directory;
that isolation must be explicitly
opted out of. A rejected fork write spawns no background job; a job-spawn failure after a successful
write still reports the written session record so it can be resumed by hand.
The resume command in that failure report is supplied by the host using the saved session id;
without one, the command gives neutral host-resume guidance.

**`/context` tool-schema accounting.** The tool-schema cost breakdown reads the **offered** tool set,
not the registered one: a tool that declares deferred loading and that the model has not yet loaded
is not sent with the request and is therefore not counted. The resulting number can fall as a direct,
observable consequence of deferral.

**`/loop` (in-session repeat).** A prompt-only invocation — self-paced or on an explicit interval —
starts unconfirmed: it is the operator's own instruction. Any form that instead falls back to the
host's default maintenance prompt — bare `/loop`, or an interval alone (`/loop <N><s|m|h|d>`, self-
paced or fixed cadence) — is gated the same way, because it is the same standing commitment (running
unattended for up to the loop's lifetime) whichever form reached it: an interactive invocation (an
ask port attached) asks the operator to confirm, naming the prompt's first line, how long it can run
unattended, and other active loops — never the internal "default prompt" wording, nor a raw
timestamp; a headless one (no ask port — a print-mode or scheduled run) is refused with
a plain message rather than starting unconfirmed, since a loop that can run for a week must not start
with nobody there to say yes; a model-invoked one is always refused outright, never silently asked or
blocked, so the model cannot start one on its own — only ever its own explicit prompt. In self-paced
mode the model chooses each delay, within a
bounded maximum, and a short reason, or stops the loop; a missing decision falls back once rather than
looping unbounded. The session record, not the disposable timer, owns resumption for either mode.
Fixed requested intervals are positive and bounded. Calendar-aligned steps only divide the
minute, hour, or day; a request between supported steps rounds up to the next one, and the rounded
step (not an exact elapsed-time figure) is what gets reported, because daylight-saving transitions
can make the actual elapsed gap shorter or longer than the nominal step. Repeated in-flight wakes
from the same loop coalesce in the bounded session queue rather than queuing a catch-up burst after
a gap. A loop's stable identity is separate from its editable display label and the underlying
scheduler's runtime task id, so renaming or a schedule restore cannot hide a loop from `/loop
list`/`/loop stop` or break the stop path. `/loop stop <id>` reaches the loop even while a turn is
running — that loop's own iteration or any other — without aborting it: an already-running iteration
finishes, and only the loop's future ones stop. A session allows a bounded number of active loops
(including paused ones); creation beyond it is refused. New loops carry an absolute expiry; an
expired loop is terminal and refuses to fire again even after a restore. Creation and stop are
strictly persisted before they report success; ordinary turn snapshots remain best-effort. A host
kill switch can block firing/re-arming while preserving paused records for a later restart, and
separately refuses new-loop creation while still allowing `list`/`stop` so existing loops stay
manageable. Autocomplete offers `list` and `stop` with `list` first, so selecting `/loop` cannot
start the host-default loop on the first Enter; directly submitting bare `/loop` still asks first
rather than creating one outright. Fixed loops carry a small stable per-loop offset to avoid
synchronized wake bursts; self-paced loops keep the model-selected delay without added jitter.
Omitted prompts use the host's live default at each iteration; an explicit schedule edit replaces
that default for the edited fixed loop.

**`orgPolicy` in `/provider`.** When an `IOrgPolicy` is supplied: a switch to a profile outside
`allowedProviders` is rejected before any settings write; a completed provider setup whose API key is
a plaintext value (not an `$ENV:` reference) is rejected when `requireApiKeyFromEnv` is set, before
the setup patch is built; and a configured `adminContact` is appended to every violation message.
Service connections delegate credential acquisition and resolution to the host; profile settings
hold only its opaque reference, and cancellation or failure before completed setup preserves the
previous profile. Ordinary editing preserves the credential; replacement requires an explicit
user connection action. Provider startup reads and writes only settings sources and
stores supplied by its host; it cannot select a user home or product settings path when those inputs
are absent.

**`/theme`.** Works through an injected theme-catalogue port. Themes belong to the terminal the user
sits at, so, as with `/keybindings`, an attached terminal runs it itself and writes the patch to its
own settings; without the port it still exists and answers that themes belong to the configured CLI terminal.
It emits at most one appearance-settings patch per invocation, and an unknown theme id writes
nothing, not even the toggles submitted alongside it.

**Semantic command roles.** Commands declare framework-owned semantic roles so model guidance follows
the composed command's identity rather than a separately maintained name. Reading skill supporting
bytes consumes the owning execution's existing activation; it cannot create consent or activate
another skill.

**Model invocation.** Trust, credential and permission-widening actions are never model-invocable,
and neither are exits or UI-only preferences: the model may suggest them, the user runs them. A
command that mixes such actions with read-only views opens only the read-only subset to the model.
Every model-invocable command carries a description written for the model — what it does, when to
use it, what it returns — and when the model asks a command to start a process, that process is
decided as a shell tool call would be — its PreToolUse hooks and guardrails, then its rules, the
mode and the prompt — rather than by consent to the command's name, so being a command is never a
way around a shell rule, and approving one monitored command never approves another. The sandbox's
auto-approval never applies to it, because that process does not run inside the sandbox.

**`/remote-control`, `/devices`, `/unlock`, `/lock`, `/doctor`, `/context`, and session command metadata.** For these commands, the
palette entry is the single source of metadata, and the executable command is projected from it;
execution policy and lifecycle remain executable-command behavior. Projecting shared metadata never
by itself grants model invocation or changes execution policy or permission requirements.
`/devices`, which acts on the user's device identity, and `/unlock` and `/lock`, which open and drop
the keys of secure conversations in the host process, also refuse an invocation from a remote surface
(and exist only where the host gives them its key custody), and `/remote-control` refuses pairing and revoking from one and never shows it the pairing
link: a connected surface that could admit a device would let each device admit the next. Remote
control offers `status` and `devices` before pairing or revoking actions, so an autocomplete
selection defaults to a read-only operation.

**Ask seam.** A command that needs input (selection pickers, setup wizards, destructive-action
confirmation) asks for it inline at the top of `execute` via the host-supplied
`context.getUserInteraction()?.ask(...)`. With no interactive renderer attached (headless/automation),
that accessor is `undefined` and the command takes its explicit no-human path rather than blocking or
guessing. The CLI does not hard-code command-specific dialog logic.

- `/loop` never wakes the agent before the requested interval has elapsed: a persisted first-fire
  boundary skips earlier clock-aligned slots, and the creation receipt names the earliest eligible
  instant. Because slots are calendar-aligned, daylight-saving changes can lengthen or shorten later
  gaps; the command does not promise an exact elapsed cadence.

### Error taxonomy

The subpath defines no custom error classes. All execution errors surface as `ICommandResult`
values with `success: false` and a human-readable message. The one thrown condition is the
`runtime` capability being unavailable when a command that requires it executes — a
non-recoverable session configuration error.

The CLI-owned plugin adapter treats a marketplace manifest fetch failure as non-fatal and returns an
empty list rather than failing the caller.

## coding

### Purpose

Robota's coding capability as a single `ICapabilityPack` — the proof that capabilities compose
additively, and the first capability pack. `createCodingPack(options)` bundles the default coding tools, coding
command modules, and coding subagents into one additive composition unit that `assembleProduct` can
compose on top of any product's base command modules — including when a product profile lets it own
the entire tool surface. It imports the real published tools/commands/subagents; it
re-implements none of them.

### Non-goals

- Does not re-implement or fork any tool, command module, or subagent.
- The subpath is Node only: it bundles the host tools and the `command/node` commands, so it maps
  `browser: null`.
- Does not assemble sessions, merge packs, or construct runtimes — that is the package root.
- Does not self-activate: a pack contributes only when a product profile lists it, and every
  contributed command/tool still runs only through the permission-gated runtime at call time.
- Is a neutral, reusable library of general coding capabilities usable by any consumer building a
  coding assistant — it carries no product-specific business logic or identity.
- Bundles only the capability-level coding command modules (`/shell`, `/editor`, `/git`) — not the
  product-shell/settings/provider command infrastructure, which a product shell composes, not a
  coding capability pack.

### Contract

- The factory passes the caller's `cwd`, optional `sandboxClient` and optional `editorFiles` straight
  through to the default tool factory; it does not maintain a separate tool list, so pack composition adds, drops, or
  reorders no defaults relative to that source.
- Tools that need an adapter, a credential or an external service (`CodebaseRetrieval`, `Computer`)
  are absent: the default set it consumes holds none.

### Design decisions

#### Session scoping — why a factory, not a constant

The pack is built by `createCodingPack({ cwd, sandboxClient })`. There is deliberately no
module-level `codingPack` constant, and that absence is a safety property, not an omission:

- A product may hand its whole tool surface to its packs (`defaultTools: []`), so the pack's tools can
  be the only file tools a session has. Without either guard, a context-free pack in that position would
  expose file tools with no working-directory root.
- The tool layer itself refuses a missing root; requiring `cwd` here is a second, assembly-time
  guarantee rather than the only one.

`cwd` is therefore required, so the scoping decision cannot be forgotten at a construction site —
callers pass the same value the session is assembled with. `sandboxClient` is optional: when present,
tools operate through the sandbox and the host path guard does not apply, because the sandbox is the
isolation boundary. Each call returns fresh instances bound to the supplied context, so two products
assembled in one process get independently-scoped file tools.
