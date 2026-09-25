# @robota-sdk/agent-command — Package Specification

## Purpose

Consolidated command module for the Robota SDK CLI. Provides all slash-command implementations as a
single importable package. Plugin commands consume an injected `ICommandPluginAdapter`; the CLI owns
the concrete adapter and plugin source loader.

## Non-goals / Boundaries

- Transport layer (WebSocket, TUI, headless) — owned by `agent-transport`.
- CLI entry point and argument parsing — owned by `agent-cli`.
- Agent runtime and session management — owned by `agent-core` / `agent-framework`.
- Command registration contracts (`ICommandModule`, `ICommandSource`, `ISystemCommand`) — defined in
  `agent-framework`.
- Plugin infrastructure (installer, loader, marketplace client) — defined in `agent-framework` and
  composed by `agent-cli`.
- This package does not depend on any other `agent-command-*` package and has no circular
  dependencies.

## Contract and guarantees

**Assembly (`createDefaultCommandModules`).** Allow-then-deny module filtering is delegated to
`agent-framework`'s `selectCommandModules` — the single filter implementation, never reimplemented
here. Any `enabled`/`disabled` module name that matched no built module (a short form, or a typo) is
returned as `unknownModuleNames` data rather than silently dropped, so the host can surface a
non-fatal notice instead of failing closed or pretending the name took effect. Skills discovery
consumes only the explicit contribution sources and ordered skill/command roots it is given; it never
selects product directories or reconstructs project reads from `cwd`.

**User-local commands.** The direct command and the assembled slash command share the host-supplied
storage root for inspection and memory operations; neither chooses a home directory itself when the
host omits that root.

**Demand-switch sessions.** The `agent` and `schedule` command modules declare
`sessionRequirements: ['agent-runtime']`: composing either module makes the session layer enable the
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
performs no write of its own outside an explicit, confirmed repair.
Report titles, product-readiness summaries, repair command text, and provider/trust remediation
are host-selected display vocabulary. Without host wording, diagnostics stay product-neutral. The
same report data and repair decisions are used by slash and shell routes.

**`/keybindings`.** The command knows nothing about the keybindings schema, defaults, contexts,
watcher, or TUI implementation — it only asks an injected capability port to ensure the user document
and hands back the returned path. Without that port injected, the default assembly does not register
the command at all.

**`/git` (host-only, blocking).** Every verb runs through an injected process port whose production
implementation is argv-only (`execFile`, `shell: false`, so no token is ever parsed as shell syntax),
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
attaching to it later is a view switch, not a merge. It runs in an isolated worktree by default so
filesystem work cannot collide with the parent's working directory; that isolation must be explicitly
opted out of. A rejected fork write spawns no background job; a job-spawn failure after a successful
write still reports the written session record so it can be resumed by hand.
The resume command in that failure report is supplied by the host using the saved session id;
without one, the command gives neutral host-resume guidance.

**`/context` tool-schema accounting.** The tool-schema cost breakdown reads the **offered** tool set,
not the registered one: a tool that declares deferred loading and that the model has not yet loaded
is not sent with the request and is therefore not counted. The resulting number can fall as a direct,
observable consequence of deferral.

**`/loop` (in-session repeat).** A bare or prompt-only invocation starts a self-paced loop; an
explicit interval keeps a fixed schedule. In self-paced mode the model chooses each delay, within a
bounded maximum, and a short reason, or stops the loop; a missing decision falls back once rather than
looping unbounded. The session record, not the disposable timer, owns resumption for either mode.
Fixed requested intervals are positive and bounded. Calendar-aligned steps only divide the
minute, hour, or day; a request between supported steps rounds up to the next one, and the rounded
step (not an exact elapsed-time figure) is what gets reported, because daylight-saving transitions
can make the actual elapsed gap shorter or longer than the nominal step. Repeated in-flight wakes
from the same loop coalesce in the bounded session queue rather than queuing a catch-up burst after
a gap. A loop's stable identity is separate from its editable display label and the underlying
scheduler's runtime task id, so renaming or a schedule restore cannot hide a loop from `/loop
list`/`/loop stop` or break the stop path. A session allows a bounded number of active loops (including
paused ones); creation beyond it is refused. New loops carry an absolute expiry; an expired
loop is terminal and refuses to fire again even after a restore. Creation and stop are strictly
persisted before they report success; ordinary turn snapshots remain best-effort. A host kill switch
can block firing/re-arming while preserving paused records for a later restart, and separately
refuses new-loop creation while still allowing `list`/`stop` so existing loops stay manageable.
Autocomplete offers `list` and `stop` with `list` first, so selecting `/loop` cannot start the
host-default loop on the first Enter; directly submitting bare `/loop` still creates one.
Fixed loops carry a small stable per-loop offset to avoid synchronized wake bursts; self-paced loops
keep the model-selected delay without added jitter. Omitted prompts use the host's live default at
each iteration; an explicit schedule edit replaces that default for the edited fixed loop.

**`orgPolicy` in `/provider`.** When an `IOrgPolicy` is supplied: a switch to a profile outside
`allowedProviders` is rejected before any settings write; a completed provider setup whose API key is
a plaintext value (not an `$ENV:` reference) is rejected when `requireApiKeyFromEnv` is set, before
the setup patch is built; and a configured `adminContact` is appended to every violation message.
`orgPolicy` is accepted at the `provider` command module level only — it is not a
`createDefaultCommandModules` option. Provider startup reads and writes only settings sources and
stores supplied by its host; it cannot select a user home or product settings path when those inputs
are absent.

**`/theme`.** Behind an injected theme-catalogue port only — with no port, there is no command. It
emits at most one appearance-settings patch per invocation, and an unknown theme id writes nothing,
not even the toggles submitted alongside it.

**Semantic command roles.** `skills`, `compact`, and `agent` declare framework-owned semantic roles
(`skillActivation`, `contextReduction`, `subagentSpawn` respectively) as metadata on their
`ISystemCommand` values. This package does not maintain a separate role-to-name registry; renaming an
owner command changes only that command's value, and the framework's projection follows the
declaration.

**Model invocation.** Trust, credential and permission-widening actions are never model-invocable,
and neither are exits or UI-only preferences: the model may suggest them, the user runs them. A
command that mixes such actions with read-only views opens only the read-only subset to the model.
Every model-invocable command carries a description written for the model — what it does, when to
use it, what it returns — and when the model asks a command to start a process, that process is
decided as a shell tool call would be — its PreToolUse hooks and guardrails, then its rules, the
mode and the prompt — rather than by consent to the command's name, so being a command is never a
way around a shell rule, and approving one monitored command never approves another. The sandbox's
auto-approval never applies to it, because that process does not run inside the sandbox.

**`/remote-control`, `/devices`, `/doctor`, `/context`, and session command metadata.** For these commands, the
palette entry is the single source of metadata, and the executable command is projected from it;
execution policy and lifecycle remain executable-command behavior. Projecting shared metadata never
by itself grants model invocation or changes execution policy or permission requirements.
`/devices`, which acts on the user's device identity, also refuses an invocation from a remote
surface. Remote
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

## Error taxonomy

This package does not define custom error classes. All execution errors surface as `ICommandResult`
values with `success: false` and a human-readable message. The one thrown condition is the
`agent-runtime` capability being unavailable when a command that requires it executes — a
non-recoverable session configuration error.

The CLI-owned plugin adapter treats a marketplace manifest fetch failure as non-fatal and returns an
empty list rather than failing the caller.
