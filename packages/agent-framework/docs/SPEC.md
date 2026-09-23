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
  common APIs.
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
- **Prompt/permission settlement is first-wins and fail-closed.** `InteractiveSession` exposes no
  session-level callback option for permission or ask prompts; it emits transport-neutral request
  events, and any attached surface settles them through one shared registry. The first settlement
  wins and emits exactly one resolution event — there is no second settlement path. A callback that
  rejects must resolve to deny/cancel, never leave the request open.
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
- **Settings layering treats `hooks` as a security boundary, not an ordinary merge.** Every other
  settings key deep-merges with a higher layer overriding a lower one; `hooks` instead merges
  per-lifecycle-event, appending each layer's groups in layer order, so a higher-trust layer can only
  _add_ hooks and can never remove one a lower layer did not itself declare — a project settings file
  cannot silently disable a user's guard hook by declaring an unrelated one. A hook group may name
  itself with an `id`; a layer may then disable ids declared by _later_ (lower-trust) layers only, so
  a user layer can turn off a project hook but not vice versa.
- **Provider resolution order is fixed and total.** An explicit settings profile always wins; failing
  that, env-default synthesis picks the first provider definition (in definition order) whose default
  API key is an unset-but-present environment reference and which also has a default model; failing
  that, provider resolution throws a typed configuration error. An existing-but-corrupt settings file
  is never treated as a missing one — it fails fast with a typed parse error naming the file and the
  parse message, rather than silently falling back to defaults.
- **Turn error surfacing is layered and never silently drops a partial answer.** Provider errors are
  classified by the provider, humanized once by this package, and rendered per-transport. A failed
  turn commits any partially streamed answer to history as an interrupted entry before stream state
  clears. Errors from outside the turn boundary (background tasks, catalog refresh, uncaught promises)
  surface through the same humanize path via `reportBackgroundError`, and the session stays usable.
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
- **Pre-trust source preview**: candidate project sources (settings, skills, agents, detection
  metadata, context, tasks, state, plugins) are listed from the paths their owners actually load, so
  the preview cannot drift from what trust would enable. Inspection reads metadata only under a
  revalidated Git identity, never follows links, never issues a content reader and grants no
  authority; where a stable no-follow walk is unavailable, names are listed with metadata unavailable.
- **Session-loop first fire**: a persisted first-allowed boundary skips earlier calendar-aligned slots
  without cancelling the loop; a boundary that is invalid or later than the loop's expiry is refused.

## Error taxonomy (shape, not enumeration)

The package defines two named error classes at the SDK boundary: one for a provider that cannot be
resolved at session start (no matching settings profile and no env-default candidate), and one for an
existing-but-corrupt settings file. Every other error propagates from the owning package it
originates in (permission denial from `agent-core`, session run failure from `agent-session`,
background task failures from `agent-executor`, project-authority refusals from the workspace-trust
layer) rather than being re-wrapped here. `InteractiveSession` catches everything from the underlying
run and emits it as an `error` event instead of throwing out of `submit()`, so a caller integrates
against one event-driven failure channel regardless of where the error originated.

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
