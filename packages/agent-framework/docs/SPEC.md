# @robota-sdk/agent-framework SPEC

## Purpose

`@robota-sdk/agent-framework` is the assembly layer of the Robota SDK. It composes `agent-core`,
`agent-session`, `agent-tools`, `agent-executor`, and the `agent-interface-transport` type contracts
into a single, provider-neutral SDK surface. `InteractiveSession` is the primary entry point; a
`createQuery({ provider })` factory covers single-shot prompt use; `createAgentRuntime()` composes a
headless/multi-session runtime.

This package owns config loading, context loading (AGENTS.md/CLAUDE.md discovery), command
infrastructure (contracts, registry, sources, common APIs consumed by command modules), permission
prompting, edit checkpointing, reversible execution policy, project memory, self-hosting verification
planning, skill discovery, background job orchestration, subagent assembly, bundle plugin management,
and the SDK-specific type definitions that tie these together.

It does not own provider implementations, the generic session run loop, tool infrastructure,
background/subagent lifecycle state machines, permission enforcement, hook execution, or any
React/Ink UI.

## Boundaries and non-goals

- **Assembly first, not a re-export layer.** Every feature composes existing packages; a
  general-purpose capability (permissions, hooks, tools, session mechanics) belongs in its owning
  package, never duplicated here. Consumers import general-purpose symbols from their owner
  (`agent-core`, `agent-session`, `agent-tools`); this package exports only what it owns or narrows
  behind an SDK facade. A pass-through re-export is allowed only for a symbol a permitted consumer
  has no other legal import path to (such as `IBackgroundTaskRunner` from `agent-executor`, in
  `background-tasks/`), so ownership stays visible in every import. This is enforced mechanically
  across every file reachable from the `exports` map, whether the re-export is a runtime value or a type.
- **React-free.** No React/Ink dependency, so the SDK stays usable from a CLI, server, worker, or
  test in any TypeScript context. React and Ink belong to `agent-cli`.
- **Provider-neutral.** The consumer creates the provider and injects it; the SDK never imports a
  concrete provider package.
- **No public project-path helper.** A `cwd` is provenance only, never filesystem authority. Project
  content and application state are reachable only through a `TWorkspaceProjectAccess` decision and
  facets minted from its opaque authority; omission is an explicit Restricted decision, not a silent
  fallback to path-based access. Restricted construction instantiates no project reader, store, or
  writer. Trusted access is accepted only when the real working directory is the trusted root or a
  descendant of it — `cwd` and the access decision are independent inputs, so this boundary check keeps the pair
  fail-closed. Once accepted, the pair is one value fixed for the session's life and handed by
  reference, never copied field by field, so no lazy operation can hold a different answer from the
  session; a move to another directory is a new session, not a mutation of this one.
- **No concrete settings-file I/O for hosts.** Host adapters (`NodeHost*`) exist for callers that
  deliberately own a host path, but never satisfy an authority parameter, and command modules must
  not assemble settings/project paths themselves — they go through host adapters or command-facing
  common APIs.
- **Every user- and project-scoped location is host-supplied, and the framework never infers or falls
  back to one.** Storage roots, project settings and state directories, user settings sources,
  plugin/skill/agent-definition roots, permission baselines, and task-context directories are all
  read only from what the host explicitly passes; an omitted discovery root means no discovery, and an
  omitted storage root fails before any filesystem write — never an ambient default. A restricted (untrusted) project can never read project settings merely because a path
  was supplied. A user-local storage root that resolves inside the active repository — including
  through a symlink — is rejected. A project settings writer requires its own separately approved
  target, and when that guarded write is unavailable, a project-wide permission approval is never
  silently downgraded to a session-only grant. A later deny rule always takes precedence over a
  host-supplied permission baseline, even across a live preset change.
- **Organization policy is host-located and fail-closed.** The policy loader reads only the path
  selected by its host. An absent or empty path is an error; a missing file at a valid path means no
  deployed policy. A present but unreadable or malformed file raises a typed error rather than
  silently disabling enforcement.
- **Recovery instructions are host-owned.** Framework errors name the missing provider configuration
  or invalid settings file without prescribing a product command. A terminal fork-attach refusal
  carries its resume session id separately so a host can add its own reopen command while neutral
  consumers still receive an actionable session identifier.
- **User contributions are host-selected.** Skill discovery uses only explicitly supplied
  contribution sources and roots; neutral SDK helpers do not infer the current process home.
- **Headless shell execution is host-owned.** The host supplies the shell adapter for explicit
  skill interpolation; the framework does not construct a child-process fallback.
- **Hosts own product identifiers; command modules own product behavior.** Attached file
  references and projected command tools use neutral identifiers unless the host supplies its own,
  and subagent lifecycle hooks add product environment aliases only when the host supplies their names.
  Model-facing identifiers remain consistent through prompt execution and child-tool filtering. SDK
  core ships no user-visible built-in commands; command packages (`agent-command-*`) contribute
  behavior through `ICommandModule`, consuming SDK command contracts and common APIs. The SDK does
  not know command ids in advance; on session shutdown it settles every module's host-scoped work
  before closing the session, even when another module's shutdown fails.

## Architecture position

`agent-framework` sits above `agent-core` (engine, provider abstraction, permissions, hooks),
`agent-session` (generic run loop, persistence ports), `agent-tools` (tool infrastructure and
built-ins), and `agent-executor` (background task / subagent lifecycle primitives), and below
`agent-cli` and other runtime shells. Command packages (`agent-command-*`) sit beside it, consuming
its command contracts without a reverse dependency. Assembly (wiring tools, provider, system prompt)
happens inside the SDK; the provider instance itself always comes from the consumer.

Within the package, `command-api/` is the stable, render-agnostic layer command modules build
against; `interactive/` holds the event-driven session wrapper; `assembly/` is the internal session
factory; `config/`, `context/`, `memory/`, `checkpoints/`, `self-hosting/`, `subagents/`,
`background-tasks/`, and `transport-host/` are the SDK-specific feature areas described below.

## Guarantees and invariants

These are behaviors a caller cannot infer from a type signature alone.

- **Prompt trace identity has a narrow execution boundary.** Every started prompt records a fresh,
  content-free trace root and its actual outcome even when it has no token usage or ends in failure
  or interruption; a failure before execution begins has no root. This remains a partial trace: it
  leaves the process only as a `traceparent` on that prompt's own provider calls and tool bodies to
  origins the host trusts, or in the environment of the child-process classes the host enabled —
  either grant alone is enough, and subagent, worker and background runs never inherit it — and it does not
  prove final turn settlement. A provider-call child's span ID is derived from core's call ID and a
  tool child's from core's minted body ID, never invented, so the propagated parent and the exported
  span are the same span; a tool body reported without that ID is counted as omitted.
  Prompt, response and tool text travels only through the host's separate content channel, only
  when the host provides one, and only for the owner-typed turns prompt history records — one shared
  predicate decides both; otherwise the framework copies no text. Tool content is limited to the
  turn's own calls: ownership comes from the permission and body events on the turn's own bus, never
  from the shared tool callback, which subagent and background runs also report through. The
  framework only pre-truncates, renders arguments without walking past the bound, and bounds what one
  turn holds with room kept for the prompt and response; redaction is the host's.
- **Session persistence is explicit, never implicit.** `InteractiveSession`/`createAgentRuntime`
  never construct a project session store from a bare `cwd`. A host wanting persistence supplies an
  explicit store (optionally composed from same-authority `sessions`/`session-logs` state facets); an
  omitted per-session store inherits the runtime store, an explicit store replaces it, and an
  explicit `undefined` disables persistence for that one session — all three are distinguishable
  states, not collapsed into "no store".
- **Fork vs. resume is exactly one bit of difference.** Resume reuses the source session id; fork
  generates a fresh id while still restoring the same messages and the parent's assembled system
  prompt verbatim — a fork inherits the parent's full assembled prompt (including any active output
  style, since that is just a section of the same string) rather than rebuilding one from current
  project files. A plain resume is not a copy and always rebuilds, so edits to AGENTS.md between
  sessions still reach it. Writing a fork's record leaves the source record byte-identical; the two
  conversations never rejoin. Attaching a surface's view to a fork is a _view switch_, never a merge.
- **Host-action parity.** A command's host actions (language change, settings reset, session
  exit/restart/rename, …) are executed by the session through injected host adapters, so headless and
  programmatic embeddings get the same command semantics as an attached UI. An embedding with no
  adapter for a requested action gets an explicit failure naming the missing capability — never a
  silent no-op. UI-only intents (opening a picker, a settings screen) are fire-and-forget: with no
  surface listening they are a defined no-op, and that never affects the host-action half.
- **Local peer status is display-only.** Host-observed activity and independently verified process
  liveness never grant authority over the peer or identify a persisted session record, and a passive
  observer can never keep a request alive after its last answering surface leaves.
- **Prompt/permission settlement is first-wins and fail-closed.** `InteractiveSession` exposes no
  session-level callback option for permission or ask prompts; it emits transport-neutral request
  events, and any attached surface settles them through one shared registry. The first settlement
  wins and emits exactly one resolution event — there is no second settlement path. A callback that
  rejects must resolve to deny/cancel, never leave the request open.
- **External events require separate source and sender admission.** Opening a source does not itself
  authorize turns: a trusted adapter must authenticate the sender, and the session checks that sender
  against a source-specific allowlist before it can submit through the ordinary turn queue; an
  untrusted submission can never claim another conversation's reserved identity. The model receives
  only an escaped, bounded envelope — file-reference shorthand in external text stays literal and
  never reads local context. An admitted external turn is text-only for model-generated actions: it
  does not expose local tool schemas, and a provider tool call it produces is rejected before
  execution. External admission is mutually exclusive with `bypassPermissions` throughout active and
  already-admitted work. Each accepted event settles from its own turn handle, and an interrupted
  result never becomes a successful reply. This does not sandbox trusted hooks/plugins or
  authenticate a platform sender by itself, and it is not a remote permission-approval channel.
- **Automatic session naming is text-only.** The title-generation call — whether triggered by an
  operator message or the first external event — always disables tool use, so hosted web tools can
  never be invoked merely to generate a title.
- **Hook executor registration is replace-vs-extend, and the built-ins are seeded first.** The core
  hook runner resolves `executors ?? createDefaultExecutors()` — an _undefined-only_ fallback, so
  supplying any executor array at all replaces the built-in `command`/`http` executors rather than
  extending them; only an actually-omitted array reactivates the defaults. Because the last executor
  registered for a given hook type wins, the framework's built-ins are seeded _before_ SDK-specific
  ones, so a caller-supplied executor of the same type still overrides the built-in — seeding them
  last would make the built-ins unoverridable, and merging instead would remove a sandboxed caller's
  ability to exclude one. The general principle: restriction must be asked for explicitly; extension
  may be assumed. A declared hook type with no runnable executor is refused before the first turn,
  naming the type and the missing option, rather than being silently discarded at every tool call.
- **Settings layers merge per key, and the rule is chosen for safety, not uniformity.** Layers are
  read user-first, project-later; the later (lower-trust) layer overrides by default, except:
  `defaultTrustLevel` keeps the most restrictive value; every `permissions` list (allow, deny, ask)
  is unioned, because an allow list is not the complete permitted set once deny, ask and ceiling
  rules outrank it, and replacing let a checked-in project file silently drop the user's rules;
  `disabledHooks` accumulates; provider/env/plugin/task-context objects
  merge field by field; and `hooks` merge per lifecycle event, appending each layer's groups, so a later
  project layer can only _add_ hooks and can never remove a user's guard by declaring an unrelated one.
  A hook group may carry an `id`; a layer may disable only ids declared by later layers, so a user can
  turn off a project hook but not the reverse.
- **A credential never follows a changed endpoint.** When a later layer changes a provider's
  `baseURL`, any `apiKey`/`apiKeyEnv` inherited from an earlier layer is dropped unless the same layer
  supplies its own, so a project file cannot redirect a user's key to a different endpoint.
- **Provider resolution order is fixed and total.** An explicit settings profile always wins; failing
  that, env-default synthesis picks the first provider definition (in definition order) whose default
  API key references an environment variable that is set and non-empty, and which also has a default
  model; failing
  that, provider resolution throws a typed configuration error. An existing-but-corrupt settings file
  is never treated as a missing one — it fails fast with a typed parse error naming the file and the
  parse message, rather than silently falling back to defaults.
- **Turn error surfacing is layered and never silently drops a partial answer.** Provider errors are
  classified by the provider, humanized once by this package, and rendered per-transport. A failed
  turn commits any partially streamed answer to history as an interrupted entry before stream state
  clears. Errors from outside the turn boundary (background tasks, catalog refresh, uncaught promises)
  surface through the same humanize path via `reportBackgroundError`, and the session stays usable.
- **Self-paced loop intent is durable before admission.** Loop state transitions are strict
  session-record writes; a failed or uncertain write can never authorize another iteration, missed
  wakes are not caught up, and an uncertain running iteration is never replayed. Only a successful,
  structured, provider-neutral decision can select the next delay or stop; an omitted or denied
  decision falls back to one bounded delay and then terminates.
- **Default loop prompts are live host content, not stored authority.** A loop created without an
  explicit prompt keeps that intent across resume, and the host resolves the current default before
  each iteration; a missing or invalid resolver fails visibly rather than running a stale iteration.
- **Tool composition is asymmetric on purpose: replace and append are not interchangeable.**
  `defaultTools` replaces the framework's default tool tier outright; `additionalTools` only appends
  and, on a name collision with an already-assembled tool, the earlier entry silently wins and the
  contributed one is dropped rather than displacing it. That asymmetry is deliberate: the default tier
  is constructed _with_ session context (the working-directory guard, sandbox client, retrieval
  adapter), and an externally-constructed contribution carries none of it, so letting a name collision
  swap one in would silently disable a security guarantee. A consumer that wants its own tools to
  fully own the surface passes an empty `defaultTools` and supplies everything through
  `additionalTools` instead — replacement stays fully expressible, just never as a side effect of a
  naming accident. The same edit-checkpoint wrap is applied to the final assembled set, so a
  contributed `Write`/`Edit` is checkpointed exactly like a default one.
- **Deferred-tool residency has a fixed assembly order.** A tool may declare itself deferred
  (withheld until the model searches for it); deduplication preserves the surviving entry's own
  residency marker rather than the first-seen one's. A configuration where every tool is deferred is
  refused outright — a session must always keep at least one resident tool — and that check runs over
  the fully declared tool set before the framework's own search tool is added, so the search tool can
  never silently satisfy the very check it exists downstream of. The search tool itself is added,
  resident, only when something in the assembled set is actually deferred, and the system prompt is
  given a roster of exactly what was withheld — a session with nothing deferred is prompt-identical to
  one without the feature at all.
- **Subagent tool filtering has a fixed order, and subagents cannot spawn subagents.** Filtering
  first unwraps any tool-call-handoff wrapper (so a child session or fork never inherits one even
  though the parent's own tool list does), then applies the agent definition's denylist, then its
  allowlist, and finally always removes agent-spawning tools regardless of either list.
- **Agent definitions resolve through three precedence tiers, highest to lowest: discovered
  definitions on disk, then definitions injected by the composition root, then the built-in set (or
  its full replacement).** A composition-root-injected definition can override a framework built-in of
  the same name, and a consumer's own on-disk definition still overrides that — "the consumer decides"
  applied uniformly. Because the injected and built-in tiers are concatenated into one array before
  loading, the loader deduplicates within that combined tier by keeping the first entry for a given
  name, so a shadowed built-in never produces two roster entries for the same agent name.
- **Tool-call handoff starts the underlying call exactly once and has exactly one declared
  degradation path.** When a policy and a supporting background runner are both present, a wrapped
  tool call races the real call against a threshold timer; if it settles first the result passes
  through unchanged and no background task is ever spawned. If the threshold fires first, the call is
  handed to the background task manager and the wrapper returns immediately — but the underlying call
  that was already running is the one adopted, never restarted or re-sent. The one declared fallback
  is: if handing off to the background manager itself fails, the wrapper keeps awaiting the same
  in-flight call in the foreground and reports the refusal once, rather than retrying or dropping the
  call.
- **Goal completion is a deterministic signal, never parsed from prose.** While a goal is active the
  model reports status through a dedicated, schema-validated tool; the loop reads only the last such
  call from the completed turn's structured tool summaries. A missing or malformed signal is always
  "no signal", never treated as satisfaction — there is no keyword or prose matching anywhere in the
  loop. Only agent-driven wakeup turns count toward the goal's iteration and no-progress bounds; a
  user's own interjected message never counts as a goal iteration.
- **The advisor never changes the main model's tool list mid-session.** Whether a session has the
  Advisor tool is decided once, when it starts; turning the advisor off or pointing it at another
  model changes only where calls go, because the main model's prompt cache is keyed on its tools.
  Conversation history reaches another vendor only after the user consented to that vendor, and
  never reaches a profile outside the organization's allowlist. Its answer is framed as guidance to
  check against the main model's own evidence, because the advisor sees only what the main model
  was shown and can verify nothing itself.
- **Background wake tracking is cleared on every exit path, not just the happy one.** A background
  task's wake-dedup entry is removed both when its turn completes normally and when it is evicted
  before completing (session abort, shutdown, or a pending-queue drop) — omitting the eviction path
  would leave the tracking id stuck forever, silently rejecting every future wake for that task.
- **Streaming is never written into the main session JSON.** High-frequency events — streaming text
  deltas, subagent transcript chunks — are written to append-only JSONL logs and transcript files, not
  to the primary session snapshot, so debugging data is available mid-stream without any risk of a
  torn or partial JSON write; the session JSON remains a fast snapshot, and the JSONL replay log is
  the recovery source when that snapshot is missing.
- **Restriction must be asked for; extension may be assumed** is the recurring shape behind several
  of the guarantees above (hook executors, tool composition, agent-definition tiers): a capability
  that is silently inferable from the _shape_ of an input (an empty vs. non-empty array, a name
  collision) has repeatedly been the source of a real regression in this codebase, so every such seam
  now requires an explicit, separately-named option rather than inferring intent from omission.

- **Workspace identity**: linked worktrees stay distinct by worktree root, while a nested working
  directory inside one worktree resolves to the same identity.
- **Pre-trust source preview**: candidate project sources (settings, host-selected skills, agents,
  detection metadata, context, tasks, state, plugins) are listed from the paths their owners actually load, so
  the preview cannot drift from what trust would enable. Inspection reads metadata only under a
  revalidated Git identity, never follows links, never issues a content reader and grants no
  authority; where a stable no-follow walk is unavailable, names are listed with metadata unavailable.
- **Session-loop first fire**: a persisted first-allowed boundary skips earlier calendar-aligned slots
  without cancelling the loop; a boundary that is invalid or later than the loop's expiry is refused.

- **Memory capture filters likely-sensitive content, heuristically.** Automatic capture and
  `/memory add` skip candidates whose text matches secret-like wording, card/ID number formats, or
  secret-shaped values (well-known credential prefixes, key blocks, JWTs, long mixed-case random runs).
  A skipped candidate is never persisted anywhere, including the pending queue. Approval accepts only a
  `pending` candidate and re-runs the check, so nothing flagged reaches durable memory. This is a
  heuristic, not a secret scanner: a secret that reads like prose can still pass.

## Error taxonomy (shape, not enumeration)

The package's own typed errors cover configuration (unresolvable provider, corrupt settings file,
unparseable org policy), workspace authority and project read limits, command registration conflicts,
and turn admission. Errors from lower packages (permission denial, session run failure, background
task failure) propagate without being re-wrapped.

There are three failure channels. `submit()` rejects when a prompt is refused before it runs
(initialization failure, shutdown, a stopped wake, or a failed pre-run step). A turn handle's
completion promise rejects with the error the turn failed on, or with a turn-not-run error that says
why a submission never became a turn. Failures during a run are emitted as `error` events.

## Testing philosophy

Feature behavior is verified at the framework level, not through the CLI, because the CLI is
considered a thin wrapper that must not be where behavior is proven. A dedicated `./testing` subpath
(excluded from the runtime bundle) builds a **real** `InteractiveSession` — real agent loop, real
built-in tools, real persistence and events — over a scripted, cassette-replayed, or recording
provider, so functional tests exercise genuine session mechanics without live network calls. A
separate lightweight session stub exists only for wiring/type tests that need no real loop, and is
intentionally owned by a different package so this one does not have to keep two competing "fake
session" concepts. A public-API surface test guards against a lower-package symbol being accidentally
re-exported through this package's root.

## Extension points

Third parties extend the SDK through a small set of seams rather than subclassing: `ICommandModule`
(commands, command sources, model-visible descriptors, session requirements), `ITransportAdapter`
(attaching a session to HTTP/WebSocket/MCP/etc.), hook executor injection (subject to the seeding and
replace-vs-extend rules above), `ISandboxClient` (routing built-in tool I/O through a sandbox), a
subagent runner factory (swapping the default in-process runner for a process- or worktree-backed
one), and the `guardrails`/`retrievalAdapter` ports read by session assembly but implemented by
nobody in this package. Each of these is deliberately a narrow, typed seam rather than an escape hatch
into internal state, so a third party cannot reach further than the contract it was given.
