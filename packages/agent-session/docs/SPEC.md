# Sessions Specification

## Purpose

Owns the CLI session lifecycle for the Robota SDK. `Session` wraps a `Robota` agent instance
with permission-gated tool execution, hook-based lifecycle events, context window tracking,
conversation compaction, and optional persistence through `IInteractiveSessionStore`. It is the
primary runtime used by the CLI application via the framework's assembly layer.

The package also owns the **runtime codec** for the persisted session record: the record's type
is owned by `agent-interface-session`, but a decoder is a mechanism, and an interface package
publishes contracts and vocabulary rather than mechanisms. The codec lives beside the
persistence paths that consume it (the store, the artifact envelope, the replay path).

## Boundaries / Non-goals

- Does not own AI provider creation — accepts a pre-constructed `IAIProvider` via injection.
- Does not own tool implementations — accepts pre-constructed tools via injection.
- Does not own system-prompt building — accepts a pre-built system message string. It owns
  exactly one model-facing prompt surface: the compaction summarization prompt, whose base
  template is domain-neutral and fully replaceable. No other model-facing prompt text
  originates in this package.
- Does not own configuration resolution or context loading (owned by the framework layer).
- Does not own the permission-evaluation algorithm or the hook execution engine (owned by
  `agent-core`); this package invokes them.
- Owns the file-persistence _primitive_, not the record or port shape: `NodeSessionStore`
  implements the store port and record type declared in `agent-interface-session`.
- No dependency on tool-registry or provider packages — tool and provider assembly, workspace
  trust, and project-path interpretation are the consuming layer's responsibility. This package
  never imports or reconstructs a workspace authority from a path.

## Contract Guarantees

### Persistence

- The store **decodes what it stores, and nothing further.** `load` validates the persisted
  `{ schemaVersion, record }` envelope and the record's shape, and reports one of
  `valid` / `missing` / `corrupt` / `unsupported` rather than `record | undefined`. Distinguishing
  a corrupt snapshot from a valid one is itself inspection, but it is _shape_ inspection only —
  the store reads no field for its meaning (no branch on `cwd`, a message body, or any other
  member), so it still holds no domain policy. A non-`valid` outcome is never treated as "no
  prior record" on a write path (a consumer that reads a damaged file to preserve fields it does
  not own must not silently overwrite it with a fresh record).
- Persistence is atomic (same-directory temp file + rename), so a crash mid-write cannot corrupt
  the previous record.
- `IHistoryEntry.timestamp` is `Date`-typed at compile time but round-trips through JSON as an
  ISO string; consumers of a loaded record must not assume a live `Date` instance.
- Memory-event and used-reference fields are audit/debug data, not baseline user-local
  preferences. Session records must not become a command source or a hidden preference store.

### The persisted record is decoded, never cast

`decodeInteractiveSessionRecord` returns a record every member of which was checked, or every
location it failed — not just the first. Four decisions a consumer depends on:

- **Dates are revived.** The contract declares timestamp fields as `Date`; JSON has no date
  type. The decoder accepts an ISO-8601 string or a live `Date` and always produces a `Date`.
- **String timestamps stay strings, but must parse.** `createdAt`/`updatedAt`-style fields are
  declared `string` but are checked as instants, because resume ordering sorts on them and an
  unparseable value must not silently sort as `NaN`.
- **Unknown keys on a declared object are a defect**, because a persisted record is written by
  this build's own code at a known version — an unrecognised member means the shape drifted.
  Fields the contract deliberately leaves open (arbitrary metadata maps) accept any key; only
  their values are constrained.
- **A `Date` value is unreachable through persistence inside an open map.** Reviving by shape
  there would risk converting a user's date-like text into a `Date`, so open-map contents decode
  as plain JSON values only.

Absence (`missing`) is deliberately not an outcome of the decoder itself — absence is a property
of a store, not of a value, so a store composes its own `missing` on top of the decoder's three
outcomes. Collapsing corruption into absence is what previously let a damaged file resume as a
silently field-stripped session.

The persisted envelope and the record it wraps share **one** version number: an incompatible
shape change bumps the same number, read by the artifact path and every session store. An optional
field may be added without a bump when an older reader rejects its unfamiliar key instead of
silently dropping it; old records remain readable by the newer decoder. The version is
deliberately not a member of the record type itself — required would oblige every producer to
set it, optional would mean "absent is acceptable," which is the permissive reader this codec
replaces. The version is read first; a version this build does not implement is reported as
`unsupported` without nested field issues, because field defects measured against another
version's shape describe the reader's expectations, not the data's condition.
An optional omitted-prompt marker on a self-paced loop survives strict decoding and re-encoding;
absence continues to mean an explicit or legacy instruction.

### Session artifact (share/export)

`session-artifact.ts` is the neutral export/import envelope over the session record — an async,
durable sibling of any live pairing channel, carrying no transport, pairing, or wire concerns of
its own. Two distinct operations: a full-fidelity round trip, and a share path that applies an
app-supplied, policy-free `redact` transform before writing bytes.

- **A `redact` must still return a record.** "Policy-free" governs which fields the app removes;
  it has never meant the result need not be a valid record. A required member must be _blanked_
  (set to an empty/neutral value), not deleted; only an optional member may be removed entirely.
  A redact that deletes a required member fails at import with a located reason, rather than
  silently producing a partial session that reaches the store.
- Import validates the envelope's schema version and then runs the same total record decoder the
  rest of the persistence paths use, so a current-but-invalid artifact is refused with the field
  path that failed rather than imported as a partial session.
- The envelope carries no link/cloud/access/redaction-_policy_ — that is a product concern owned
  by the app surfaces, not this package.

### Sensitive-key scrubbing

This package owns the single definition of which keys are secrets (`isSensitiveKey`,
`scrubSensitiveKeys`), consumed both by the live session logger (persistence-time redaction) and,
opt-in, by an app's share-artifact `redact`. It is never forced into the full-fidelity local
round trip — a local round trip must be lossless.

### Session construction and runtime options

- An omitted `sessionId` generates a fresh id; a provided one is reused — this lets the consuming
  layer control whether a resumed session continues under the same persisted file or starts a
  new one.
- A provided idle-timeout value is enforced per provider call and its timer refreshes on
  streaming text deltas.
- Provider-round and permitted-tool-body completions are forwarded to the session's event bus as
  content-free observations (time, round, outcome only), scoped to the active run; the public
  `run()` call shape is unchanged and an observer failure can never replace the tool result.
- An omitted turn/round cap means the session run has no core round cap and is instead bounded by
  abort, context-window checks, provider idle timeout, and runtime-level controls.
- The context-update callback fires twice per turn: once before the provider call (estimated,
  from assembled request history) and once after (exact provider usage when available).
- An ephemeral per-turn system-context string is a thin pass-through into the core run options: a
  transient system-role block included in that turn's model call only, never persisted to
  history. This package owns no part of that guarantee — it only forwards the value.
- For informational pre/post-model-call hooks, an unset model-effort value is reported as `auto`
  so the provider adapter — not the session — chooses the documented default. These hooks are
  fire-and-forget and cannot block or mutate the call.
- The automatic-compaction trigger is a `0 < value <= 1` fraction of the context window
  (default `0.835`), or `false` to disable it for an embedding runtime that manages compaction
  externally; it can be changed after construction and takes effect on the next `run()`.
- Compaction-event metadata carries one `trigger` value (`manual` by default for an explicit
  call, `auto` for auto-compaction) that flows unchanged into the hook system, the session log,
  and the caller's own callback — nothing along that path re-derives the trigger independently.
- The active-preset id and the parallel-subagents flag are **pure state**: setting them records
  the value and does not re-apply any preset's options (permission, model, persona). Higher
  layers own re-application. The parallel-subagents flag is only meaningful when the agent
  runtime was assembled to support it.

### Turn identity — one turn at a time

A session runs one turn at a time:

- `run()` passes an explicit per-turn `toolChoice` through to the agent. It affects only that run;
  the session's configured default and later turns are unchanged.
- `run()` claims the turn synchronously, before its first `await`. A concurrent `run()` is
  **refused** (not queued, not pre-empting) with a recoverable busy error, because a session is a
  single conversation and cancelling the running turn would discard work the caller never asked
  to abandon.
- The claim is released only by the turn that took it, whether it resolves or rejects. A
  late-finishing turn cannot free a claim a newer one already holds.
- `abort()` signals; it does not release. A turn is over when it has stopped, not when it was
  asked to — `isRunning()` stays true while an aborted turn unwinds, and a `run()` call during
  that window is still refused. Cancel-and-restart is `abort()` → await the turn → `run()`.
- `isRunning()` is authoritative; a consumer does not need a parallel busy flag of its own.
- Every internal wait that can park a turn (notably permission-approval prompts) observes the
  same cancellation signal. An abort resolves a pending approval as **deny** (fail closed) so the
  turn can unwind — it can never be converted into approval.
- Direct runtime-tool invocation claims the same exclusive turn slot as `run()`: overlapping
  direct calls or turns are refused rather than queued, cancellation keeps the claim until the
  underlying execution settles, and shutdown drains any direct execution before destroying the
  agent. A direct call cannot open an interactive permission prompt — a decision that would
  require interaction fails closed rather than blocking.
- Concurrency _across transports_ (e.g. correlating requests from multiple external callers) is
  explicitly out of scope for this contract; it is owned by a different object one layer up.

### Execution root

A session's working directory is a required construction input, not derived from the process's
own ambient working directory. Without an explicit root, every hook input, the permission
enforcer's root, and the persisted record would inherit process state rather than the session's
own — which previously caused a subagent to run in its parent's directory instead of its own
workspace. It is readable back so a fork or subagent derived from a session can ask which root
that session actually uses instead of re-deriving one that could disagree.

### Permission and consent semantics

- A caller may attach a synchronous guard to the session's permission-mode transition boundary.
  A denied transition leaves the current mode intact, regardless of whether the caller was a
  command, preset, or SDK client; removing the guard restores ordinary transitions.
- Malformed permission patterns (an unparseable URL pattern, an argument-scoped pattern for a
  tool with no argument key, syntactic junk) are refused at construction, before any turn runs —
  not discovered lazily at the moment a matching tool call arrives. A pattern naming a tool with
  no registered profile _yet_ is not refused, since a later-loaded pack may declare it.
- "Allow always" consent (session- or project-scoped) is remembered as a permission _pattern_
  projected from the invocation's argument — not the bare tool name. Approving one path, URL, or
  command family does not implicitly approve every other invocation of the same tool; a
  materially different argument prompts again.
- Project-scoped consent requires an installed persistence callback. If it is unavailable or the
  write fails, the approval is rejected without remembering a session-scoped grant.
- A relative `path`-kind argument is canonicalised against the session's working directory before
  the permission gate, the hooks, the log, and the tool itself see it, so an absolute allow/deny
  pattern judges the argument correctly instead of being reported unevaluable.

### Hook lifecycle

`SessionStart` fires once at construction; `UserPromptSubmit` before each turn; `Stop` after each
successful response; `StopFailure` on a model-turn error; `SessionEnd` exactly once from
`shutdown()`, after local persistence and before the wrapped agent is destroyed (so no
session-owned timers or listeners survive shutdown). Each shutdown step is best-effort.

When a turn's trace context enables hooks, only a hook fired on that turn's own path hands its
command children the prompt root's `TRACEPARENT`, so their spans sit beside the turn's provider and
tool spans. That path is the turn from prompt submission to its stop or failure: the tool-use and
permission hooks of its tool calls, its model-call hooks, and both compaction hooks of a
compaction the turn itself triggers. A hook fired with no prompt in flight — session start and end,
either hook of a user-requested compaction — receives nothing, because there is no root for it to
name. The tool-use hooks take the root from the tool call's context, apart from the body's
own span, which belongs to the tool alone.

`PreToolUse` is the **one enforcing** hook event: a hook that reaches no verdict there denies the
tool call. Every other event is advisory — a failure is reported, and the turn proceeds. This
package is responsible for two of the documented deny causes: a hook execution error (timeout,
transport failure, malformed response, non-zero exit), and a configured hook type with no
registered executor — denying rather than silently skipping a gate the user configured. When
both apply in the same turn they are reported as a single combined reason rather than one at a
time, because a fail-closed gate that reveals its reasons one per retry is a gate an operator has
to debug by being repeatedly stopped.

### Session logging

The session log is an append-only, structured record sufficient to reconstruct what was sent to
the model and what came back, written through explicit source/sink ports rather than opening a
path directly. Guarantees that are not obvious from the types:

- Every persisted line carries an envelope (schema version, timestamp, session id, event name)
  that the logger owns; event payload data cannot override those fields.
- Decoding is total and fails closed: an unknown event name, a malformed envelope or payload, or
  an unsupported version fails the _whole_ decode rather than silently dropping the offending
  line and keeping its valid siblings — a partial recovery is never produced.
- Recursive secret redaction runs before persistence (keys such as API keys, tokens, passwords).
- Oversized log fields are spilled to content-addressed sidecar files rather than inlined, and
  are written with an exclusive-create flag rather than an existence check followed by a write —
  the latter was a TOCTOU race between concurrent sessions externalizing the same payload; because
  the filename is the content's own hash, a collision on an existing file means the bytes are
  already identical and is safely ignored.
- Log directories and files are created explicitly owner-only (not inherited from the process
  umask), and every session id used as a path component is validated as a single safe path
  segment before use.
- Reading enforces the same sidecar containment and integrity guarantees as writing: absolute
  paths, traversal, and symlink escape from the supplied base are rejected; byte length and
  content hash are verified before a payload is trusted; a bounded nesting depth and an aggregate
  byte budget apply per resolution so one read cannot unbounded-allocate.
- Replay is all-or-nothing per input: a missing source is an empty replay, but a malformed
  nonempty source is never silently treated as an empty one, and an unresolved sidecar reference
  left inside a message or response fails validation rather than being replayed as-is.

### Prompt history file

The cross-session prompt-history file is a **derived, append-only projection** of prompts a
person typed, existing only so a search can run across sessions and projects without decoding a
full session record. It is rebuildable in principle and never authoritative — the session record
remains the owner of every message. Reads walk the file backwards in blocks so the newest
entries are yielded first; a line spanning a block boundary is still parsed correctly, and a line
that fails to parse is counted, never silently dropped. Only a missing file is treated as the
empty state; every other read failure is surfaced rather than presented as an empty history, so a
person is never shown "no history" when history could not actually be read.

### Compaction

- The summarization provider call is text-only (`toolChoice: none`) for manual and automatic
  compaction, regardless of the next turn's tool policy. Provider-hosted web tools must not run
  while summarizing session history.
- The project-context system message is preserved across compaction — it is excluded from the
  summarization input, and re-injected (ahead of the generated summary) after history is
  cleared, so the model does not lose awareness of its working directory, rules, and tools after
  a summary replaces the conversation.
- **History is append-only source data; a failed compaction must never destroy it.** A summary is
  valid only if the provider returns a non-empty (non-whitespace) string; an invalid summary
  throws rather than being replaced with a placeholder, and history, the context tracker, and the
  persisted session file are left exactly as they were before the attempt. Both manual and
  automatic compaction propagate this failure to the caller rather than silently continuing
  toward context overflow.
- A cancellation during compaction is a failure for this purpose, not a completed compaction: the
  abort signal is checked both before and after the provider call, and is reported distinctly
  from an ordinary compaction failure so a user's own cancellation is never recorded as a failed
  turn. History is untouched either way.
- Nothing to summarise is a no-op, not a summary — judged against the messages that would
  actually be compacted (system messages excluded), not the full history, since a fresh session
  holds only a system message before its first turn and that must not be replaced with an empty
  summary. No hook fires and no compaction event is recorded for a no-op.
- Auto-compaction triggers at the _start_ of a run (before the new user message is processed), so
  it cannot interfere with an in-flight response stream.

### Abort behavior

A running turn's partial response is always committed to history on abort (marked interrupted;
text is never stripped). The underlying run always returns normally on abort — it never throws —
and the session's post-run check is the sole source of the abort error surfaced to the caller.

### Tool-result spill store

Oversized tool results are spilled to disk without exposing where or what they are. The store lives in
an unpredictable, owner-only directory (created with `mkdtemp`, mode `0700`); each result is written to
an exclusively created `0600` file and addressed by a random, opaque `tool-result:` reference. No path,
digest or payload appears in references or diagnostics, failures carry no secret material, and spilled
results are removed on expiry and on shutdown. The temporary directory prefix is product-neutral and
does not disclose the host product's name.

## Error Taxonomy

- Tool permission denial and a hook blocking a tool are both returned as failed tool results, not
  thrown — this is deliberate: letting either throw would corrupt conversation history with an
  unmatched tool-call/tool-result pair.
- An unknown tool call similarly returns a failed result rather than throwing.
- A `run()` failure is logged with its detail, then re-thrown after history up to the failure
  point is preserved intact — the session itself remains usable for a retry or a new turn.
- An invalid compaction summary throws a dedicated error and leaves history untouched (see
  Compaction above).

## Design Decisions

- **Facade + Decorator + Composition.** `Session` hides agent creation, tool registration,
  permission wiring, and hook execution behind `run()`; each tool is wrapped by a
  permission-checking proxy before registration; `Session` composes (rather than reimplements)
  permission enforcement, context tracking, and compaction as separate collaborators, so each can
  be reasoned about and tested independently.
- **Null Object for persistence.** Without a configured store, persistence is silently skipped
  rather than requiring every call site to branch on whether one exists.
- **Decoder lives beside its consumers, not beside the type.** The record type is owned by the
  interface package; the decoder is owned here, because an interface package publishes contracts
  and vocabulary, not mechanisms, and every consumer that routes through the decoder — the store,
  the artifact envelope, the replay path — lives in this package or in the layer that depends on
  it.
