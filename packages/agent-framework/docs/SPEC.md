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
  package, never duplicated here. Pass-through re-exports of another package's symbols are forbidden
  except through two explicit SDK facade barrels (`background-tasks/`, `subagents/`) that exist only
  because a permitted consumer would otherwise have no way to reach the symbol. This is enforced
  mechanically, and the check is about the _location_ of a pass-through, not whether it is a runtime
  value or a type.
- **React-free.** No React/Ink dependency, so the SDK stays usable from a CLI, server, worker, or
  test in any TypeScript context. React and Ink belong to `agent-cli`.
- **Provider-neutral.** The consumer creates the provider and injects it; the SDK never imports a
  concrete provider package.
- **No public project-path helper.** A `cwd` is provenance only, never filesystem authority. Project
  content and application state are reachable only through a `TWorkspaceProjectAccess` decision and
  facets minted from its opaque authority; omission is an explicit Restricted decision, not a silent
  fallback to path-based access. Restricted construction instantiates no project reader, store, or
  writer. Trusted access is accepted only when the real working directory is the trusted root or a
  descendant of it — `cwd` and the access decision are independent inputs today, so this boundary
  check exists specifically to keep that pair fail-closed until they are unified into one binding.
- **No concrete settings-file I/O for hosts.** Host adapters (`NodeHost*`) exist for callers that
  deliberately own a host path, but never satisfy an authority parameter, and command modules must
  not assemble settings/project paths themselves — they go through host adapters or command-facing
  common APIs. User persistence and trust-store adapters require explicit host paths; these
  adapters do not select a product's user-local storage root.
- **User-local storage requires host authority.** Inspection and memory operations receive an
  explicit absolute storage root from their host; omission fails before any filesystem write.
  They reject roots inside the active repository, including symlink aliases.
- **Project settings locations belong to the host.** The framework binds ordered host-supplied
  relative settings paths to the current trusted project reader; absent paths read no project
  settings, and a restricted project cannot read them even when paths are supplied. A project
  settings writer also requires a separately approved root-relative target, which it copies into
  the authority-bound writer; the framework neither selects product directory names nor advertises
  those paths in its own pre-trust inventory. Project-wide permission persistence is offered only
  where that guarded mutation is supported; an unavailable writer never downgrades a project-wide
  approval to a session-only grant.
- **Project state locations belong to the host.** An issuing trust service snapshots and validates
  the host's project-relative directories for sessions, replay logs, memory, and checkpoints into
  each authority. State facets require that selection and a live trusted authority; omission never
  falls back to a framework product path. State reads, writes, replay reports, and checkpoint
  self-capture exclusion use the same bound directories. The framework advertises no product state
  paths before trust.
- **Interactive user settings are explicit.** A session reads only the host-supplied user settings
  sources, and a provider switch reuses those same sources; an absent list never discovers an ambient
  home-directory settings file. SDK runtime, query, and programmatic-agent creators forward the
  same optional sources to their sessions. A runtime without host command adapters does not attach
  an ambient settings-file reader or writer; settings actions require a host-supplied adapter.
  User-settings reset takes an explicit file path. Plugin discovery likewise requires a host-selected
  enablement source and host-selected user/project plugin directories; without either, an interactive
  session admits no bundle plugins. Project plugin directories are admitted only under trusted
  project access. The framework chooses no product plugin location.
- **Permission baselines are host-selected.** Session assembly adds no product-specific file patterns
  to a caller's permission configuration. A host may supply baseline allow patterns independently of
  the active preset; those patterns remain in effect when the preset is changed live, while a later
  deny rule still takes precedence.
- **Recovery instructions are host-owned.** Framework errors name the missing provider configuration
  or invalid settings file without prescribing a product command. A terminal fork-attach refusal
  carries its resume session id separately so a host can add its own reopen command while neutral
  consumers still receive an actionable session identifier.
- **Organization policy is host-located and fail-closed.** The policy loader reads only the path
  selected by its host. An absent or empty path is an error; a missing file at a valid path means no
  deployed policy. A present but unreadable or malformed file raises a typed error rather than
  silently disabling enforcement.
- **Agent definition discovery is host-directed.** The framework searches only the ordered relative
  directories supplied by the host; absent roots mean no file discovery. Discovered definitions keep
  precedence over injected and built-in definitions, without selecting a product's directory names.
- **Skill discovery is host-directed.** The framework scans only the ordered skill/command roots and
  contribution sources supplied by the host; either omitted means no filesystem skill discovery.
  Inspection and executable discovery use the same root descriptors, so a host can preview the exact
  roots that a trusted session would load without the framework choosing product directories.
- **Task-context discovery is host-directed.** The framework reads no ambient task directory. A host
  must supply a nonempty relative directory; enablement may explicitly disable it. The same
  selection controls trusted prompt loading and pre-trust candidate inventory. Omission, an empty
  directory, or explicit disablement yields no task path.
- **Command modules own product behavior.** SDK core ships no user-visible built-in commands; command
  packages (`agent-command-*`) contribute behavior through `ICommandModule`, consuming SDK command
  contracts and common APIs. The SDK does not know command ids in advance.

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

- **Prompt trace identity has a narrow execution boundary.** A started prompt records a fresh,
  content-free OpenTelemetry-compatible root identity and actual start/end times in its canonical
  usage observation, even if it has no token usage or ends in failure/interruption. The root ends
  at the first terminal prompt callback, recording that callback's outcome independently; later
  context refresh, wake finalization, notification, and handle settlement are outside it. A
  failure before prompt execution begins has no root.
  Each provider round and each awaited, permitted tool body observed inside the run may add a
  separately timed, content-free child with explicit trace and parent IDs. Tool permissions and
  hooks are outside the body interval, and a background handoff closes the foreground body when
  it returns; later detached work is not parented under that closed span. This remains a partial
  trace without cross-process propagation or proof of final turn settlement.
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
- **Local peer status is display-only.** The command-facing peer adapter can carry a host-observed
  fixed activity state alongside independently verified process liveness. Neither field grants
  authority over the peer or identifies a persisted session record. The session's activity snapshot
  reads execution ownership and parked prompt count without subscribing to permission/ask events;
  a passive observer can never keep a request alive after its last answering surface leaves.
- **Prompt/permission settlement is first-wins and fail-closed.** `InteractiveSession` exposes no
  session-level callback option for permission or ask prompts; it emits transport-neutral request
  events, and any attached surface settles them through one shared registry. The first settlement
  wins and emits exactly one resolution event — there is no second settlement path. A callback that
  rejects must resolve to deny/cancel, never leave the request open.
- **External events require separate source and sender admission.** A host must explicitly open a
  source; merely configuring a transport does not authorize turns. A trusted adapter authenticates
  the sender, and the session checks that sender against its source-specific allowlist before using
  the ordinary bounded turn queue. The host assigns source/sender/conversation attribution, so one
  conversation may coalesce only its own pending input; an untrusted public submission cannot claim
  that reserved identity. The model receives an escaped, bounded source envelope; file-reference
  shorthand in external text remains literal and never reads operator-selected local context.
  An admitted external turn is text-only for model-generated actions: it passes a run-scoped
  `toolChoice: none` to the session, does not expose local tool schemas, and rejects a provider
  tool call before execution. This does not sandbox trusted hooks/plugins or authenticate a
  platform sender by itself; the adapter must actually verify that sender. Operator and other
  non-external turns keep their own tool policy.
  Each accepted event settles from its own turn handle, and an interrupted result never becomes a
  successful reply. External admission and `bypassPermissions` are
  mutually exclusive throughout active and already-admitted work, not only at startup. This SDK
  ingress is not yet an MCP adapter or a remote permission-approval channel.
- **Automatic session naming is text-only.** Its separate provider call may be triggered by the
  first external event as well as by an operator message, so it always selects `toolChoice: none`;
  the provider's configured hosted web tools cannot be used merely to generate a title.
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
  `defaultTrustLevel` keeps the most restrictive value; `permissions.deny` is unioned while
  `permissions.allow` is replaced; `disabledHooks` accumulates; provider/env/plugin/task-context objects
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
- **Self-paced loop intent is durable before admission.** Creation, wake claim, running entry,
  rescheduling, and stop are strict session-record writes; a failed or uncertain write cannot
  authorize another iteration. The scheduler's one-shot task is replaceable, while the session-owned
  loop identity survives resume. Missed wakes do not catch up; an uncertain running iteration is
  not replayed. Only a successfully executed, structured, provider-neutral decision can select a
  one-minute to one-hour delay or stop; an omitted or denied decision permits one 20-minute fallback
  and then terminates. A stop removes only
  that loop's queued wake, and a running iteration may finish without arming a successor.
- **Default loop prompts are live host content, not stored authority.** A loop created without an
  explicit prompt retains that intent across resume. The host resolves the current default before
  each admitted iteration; a missing or invalid resolver fails visibly and cannot run a stale
  self-paced iteration. Explicit prompts never invoke this resolver.
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
  `/memory add` skip candidates whose text matches secret-like wording (key, secret, token, password,
  private key) or card/ID number formats; skipped candidates are not written to memory but stay in the
  pending queue. This is a keyword and format filter, not a secret scanner.

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
