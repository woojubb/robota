# Sessions Specification

## Purpose

Owns the session lifecycle for the Robota SDK. `Session` wraps a `ConversationAgent` agent instance
with permission-gated tool execution governed by current host scheduling intent without granting
permission or replay authority; its live observations preserve typed results, including refusals before
execution, and registered source attribution alongside their call identity, hook-based lifecycle events, context window tracking,
conversation compaction, and optional persistence through `IInteractiveSessionStore`. It is the
primary runtime used by the CLI application via the framework's assembly layer.

Its main entry is platform-neutral: it runs in a browser, a Web Worker, Node, Deno and Bun and
reaches no Node built-in or global. What needs a host — the file system, the process, the home
directory — is either behind the `./node` subpath or an injected port; the package has no host
default, so a composition root decides what a session may touch.

The package also owns the **runtime codec** for the persisted session record: the record's type
is owned by `agent-interface/session`, but a decoder is a mechanism, and an interface package
publishes contracts and vocabulary rather than mechanisms. The codec lives beside the
persistence paths that consume it (the store, the artifact envelope, the replay path).

## Boundaries / Non-goals

- Does not own AI provider creation — accepts a pre-constructed `IAIProvider` via injection, with explicit borrowed lifetime leaving close responsibility to its external owner and owned lifetime as the default. Which hosted tools (such as model-native web search) a provider runs is decided where it is constructed; creating a session or swapping its provider never switches one on.
- Does not own tool implementations — accepts pre-constructed tools via injection.
- Does not own system-prompt building — accepts a pre-built system message string. It owns
  exactly one model-facing prompt surface: the compaction summarization prompt, whose base
  template is domain-neutral and fully replaceable. No other model-facing prompt text
  originates in this package.
- Does not own configuration resolution or context loading (owned by the framework layer).
- Does not own the permission-evaluation algorithm or the hook execution engine (owned by
  `agent-core`); this package invokes them.
- Owns the file-persistence _primitive_ and the stored form of a record (whoever builds a store
  states whether it seals, with a sealer or `'plain'`; there is no default), not the record or port
  shape: `NodeSessionStore` (on `./node`) implements the store port and record type declared in
  `agent-interface/session`.
- No dependency on tool-registry or provider packages — tool and provider assembly, workspace
  trust, and project-path interpretation are the consuming layer's responsibility. This package
  never imports or reconstructs a workspace authority from a path.

## Contract Guarantees

### Persistence

- The store **decodes what it stores, and nothing further.** `load` validates the persisted
  `{ schemaVersion, record }` envelope and the record's shape, and reports one of
  `valid` / `missing` / `corrupt` / `unsupported` / `locked` rather than `record | undefined`.
  Distinguishing a corrupt snapshot from a valid one is itself inspection, but it is _shape_
  inspection only — the store reads no field for its meaning (no branch on `cwd`, a message body,
  or any other member) except the record's own id, which must be the id it is stored under, so it
  still holds no domain policy. A non-`valid` outcome is never treated as "no prior record" on a
  write path (a consumer that reads a damaged file to preserve fields it does not own must not
  silently overwrite it with a fresh record), and a `save` itself refuses to replace a file that
  may be a session nobody here can read: a sealed one its store cannot open and cannot prove it
  wrote or holds, one sealed by a newer build, or one it could not read at all. Only "no such
  file" means there is nothing to protect.
- Persistence is atomic (same-directory temp file + rename), so a crash mid-write cannot corrupt
  the previous record; an accepted user message and an assistant tool-call intent are checkpointed
  synchronously before that turn can dispatch an effect, and a failed checkpoint refuses dispatch.
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
outcomes. Collapsing corruption into absence would let a damaged file resume as a
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
The optional `useDefaultPrompt` marker on a self-paced loop survives strict decoding and
re-encoding; its absence means the loop's own stored instruction.

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
  streamed reply and reasoning text, since a model that is only reasoning is still working.
- Provider-round and permitted-tool-body completions are forwarded to the session's event bus as
  content-free observations (time, round, outcome, and a tool body's tool name — a label, never its
  arguments or output), scoped to the active run; an observer failure can never replace the tool result.
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
  externally; it can be changed after construction and takes effect on the next `run()`. The
  window and summarization model follow the active model, while an explicit host context budget
  and its automatic-compaction policy survive model changes.
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
  agent. A direct call opens an interactive permission prompt, or puts a question through the
  session's ask port, only when its caller asks for that because it answers its own prompts, and
  cancelling the call withdraws a prompt it opened; otherwise a decision that would require
  interaction fails closed rather than blocking, and a question finds no one to ask, because a
  remote caller is not assumed to have a person behind it.
- Concurrency _across transports_ (e.g. correlating requests from multiple external callers) is
  explicitly out of scope for this contract; it is owned by a different object one layer up.

### Recoverable execution and checkpointed approval

- An execution journal supplied to a turn is awaited by the agent and by session compaction
  before their results change history, and a rejected write stays a persistence failure even when
  cancellation was also requested. Observer logging is never a persistence barrier.
- A saved execution continues without new input only in the same session and workspace, named by
  its saved checkpoint rather than by transcript attribution, which is display-only; a peer
  turn's restrictions are restored from that checkpoint.
- Saved identity never authorizes an effect: each is admitted under current permissions and hooks
  for its effective arguments. A checkpointed approval answers one exact action and its arguments
  and grants no session consent; a saved denial stays binding even if policy has since become
  more permissive.
- A journaled execution whose last round is open in history — parked on saved waits, or stopped
  by a failure after its tool calls were committed — blocks new input, because input added behind
  it would follow unanswered calls and diverge from the checkpoint it must continue. The session
  exposes it — also after a cancellation that ended the turn once a wait was saved — so the host
  can resume or abandon it, and offers only waits whose effect was never admitted for an answer.
  An acknowledged available conversation snapshot preserves that admission block across same-owner
  restoration; discovery data never replaces the host journal. Settled history permits new input
  only after its configured synchronous checkpoint acknowledges removal of the block. A failed
  save retains admission until an explicit checkpoint succeeds, without replaying execution.
- Abandoning runs nothing and writes nothing to the journal: the open calls are closed in history
  as failed, so the conversation stays well-formed and can no longer resume that execution. Its
  journal records remain the host's to keep or discard. Abandonment must never become a route to
  replay an effect or to claim an outcome nobody recorded. Restored discovery cannot prove an
  effect never started, and abandonment must acknowledge its configured checkpoint before returning.
- A wait holds no live approver. The turn claim is held until the execution and its pending writes
  settle. Injected classifiers, hooks and tools own their own model calls and must declare their
  journal integration separately.

### Host ports

A session has no default for anything that comes from the machine it runs on, and each port's
absence is a safe answer rather than a guess:

- Hook executors are required, because running a hook handler needs a host. A session built
  without a list is refused at construction rather than left to skip every configured hook; an
  empty list runs none, and a configured hook type with no executor is reported, not skipped.
- An absent home directory is unknown: `~`, and any home-relative target not provably inside it
  (`~/..`), is refused as a critical target, and a path inside it is not expanded into one the gate
  could match.
- Without a workspace resolver, a shell command naming a path is not judged read-only, because a
  symlink inside the workspace can point anywhere and no filesystem can say where this one does.
- Without a canonicalizer, the session's directory is compared as written; a host that follows
  symlinks supplies the function so a saved snapshot, journal or approval names the same directory
  in whatever spelling it was written.
- A log buffers its streamed tail and flushes it on exit only through a host-supplied registrar;
  one registrar is handed one flush for every logger, so a process has one exit listener however
  many loggers it creates.

### Execution root

A session's working directory is a required construction input, not derived from the process's own
ambient working directory, and must be absolute in either platform's spelling — a drive or UNC root
counts on a POSIX host too, since a session may drive a workspace on the other platform. Without an
explicit root, every hook input, the permission enforcer's root, and the persisted record would
inherit process state rather than the session's own, and a subagent could run in its parent's
directory instead of its own workspace. It is readable back so a fork or subagent
derived from a session can ask which root that session actually uses instead of re-deriving one that
could disagree.

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
- In `auto` mode the classifier stands in for a person only where the gate would have asked
  one and nothing requires a person: an `ask` rule, a critical removal, a protected path and an
  ask-everything policy still reach a person. A classifier that keeps refusing hands the decision
  back to a person rather than denying indefinitely. A session with no classifier refuses the mode.

### Hook lifecycle

`SessionStart` fires once at construction; `UserPromptSubmit` before each turn; `Stop` after each
successful response; `StopFailure` on a model-turn error; `SessionEnd` exactly once from
`shutdown()`, after active execution has drained and local persistence has captured its settled
history, before the wrapped agent is destroyed (so no session-owned timers or listeners survive
shutdown). No-input continuation omits prompt submission and turn-level completion hooks because those hook effects have no durable receipts.
Each shutdown step is best-effort.

When a turn's trace context enables hooks, only a hook fired on that turn's own path hands its
command children the prompt root's `TRACEPARENT`, so their spans sit beside the turn's provider and
tool spans. That path is the turn from prompt submission to its stop or failure: the tool-use and
permission hooks of its tool calls, its model-call hooks, and both compaction hooks of a
compaction the turn itself triggers. A hook fired with no prompt in flight — session start and end,
either hook of a user-requested compaction — receives nothing, because there is no root for it to
name. The tool-use hooks take the root from the tool call's context, apart from the body's
own span, which belongs to the tool alone.

`PreToolUse` is the **one enforcing** hook event: a hook that reaches no verdict there denies the
tool call. A command hook's `allow` stands in for a person's prompt only, never for a deny rule, a
refusal from the mode, the `auto` classifier, or an ask that must reach a person: a hook is one more
approver, not a way around the policy. Its `ask` reaches a person every time, since the hook asks
again on each call. The input selected by PreToolUse must reach a stable verdict from every
enforcing hook before permission or execution; approval of an earlier input cannot authorize a
replacement. An action whose caller cannot apply a replacement is refused rather than authorized
against arguments it will not run. Every other event is advisory — a failure
is reported, and the turn proceeds. This package is responsible for two of the documented deny
causes: a hook execution error (timeout, transport failure, malformed response, non-zero exit), and
a configured hook type with no registered executor — denying rather than silently skipping a gate
the user configured. When both apply in the same turn they are reported as a single combined reason
rather than one at a time, because a fail-closed gate that reveals its reasons one per retry is a
gate an operator has to debug by being repeatedly stopped.

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
- Oversized log fields are spilled to sidecar files rather than inlined, written with an
  exclusive-create flag rather than an existence check followed by a write — the latter is a
  TOCTOU race between concurrent sessions externalizing the same payload. A plain sidecar's name is
  the content's own hash, so a collision on an existing file means the bytes are already identical
  and is safely ignored; a sealed sidecar's name is random, so no name says what a payload holds or
  which payloads are equal, its digest lives only inside the sealed line, and a sink writes each
  payload once per process. A plain sidecar a migration seals keeps its content-derived name, since
  references — nested ones inside other payloads too — name it and must keep resolving.
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
person is never shown "no history" when history could not actually be read. A sealed prompt this
process cannot open now is counted apart from damage, and says whether an unlock here would read
it, so a surface names an unlock only when one would help.

Compaction rewrites every entry sealed, one per line, under the one sealer it is given. The file has
no lock and writers append by path, so the new file replaces it by rename and what reached the old one
meanwhile is caught up from its descriptor — before the rename on Windows, which will not replace a
file while any handle on it is open, so a rename another handle blocks is retried and then fails with
nothing replaced; a crash inside that window can lose those entries, which is accepted because the
file is a derived copy of the records. Nothing that does not open is dropped, plaintext that reaches
the new file anyway is reported rather than hidden, a catch-up that fails says how much it left unread
(on Windows it abandons the compaction instead, replacing nothing), a compaction that finds the file
already replaced by another abandons its rename rather than discard what that one caught up, one that
finds it deleted puts nothing back, and a history that is a link or has another name is refused, since
a rename would leave the plaintext where it points.

### Compaction

- The summarization provider call is text-only (`toolChoice: none`) for manual and automatic
  compaction, regardless of the next turn's tool policy. Provider-hosted web tools must not run
  while summarizing session history, and summary text must not enter the response stream.
- The project-context system message is preserved across compaction — it is excluded from the
  summarization input, and re-injected (ahead of the generated summary) after history is
  cleared, so the model does not lose awareness of its working directory, rules, and tools after
  a summary replaces the conversation. Tool identities, recorded outcomes and source attribution
  survive independently of the generated summary, because lossy prose must not turn failures into
  success or authorize repeating an effect; retained attribution remains observation, not authority.
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
- A conversation handed to a model as text keeps its tool calls and results, marks a user message
  a peer session sent as coming from that peer, and holds each message to its own encoded line — a
  peer's words must never read as the operator's own, and no content can pose as another message.
  Compaction and every other such consumer use the one rendering, so what a summary keeps and what
  another reader sees cannot drift apart.
- Auto-compaction budgets the pending input, including hook enrichment and transient system
  context, before admitting that input to conversation history. Only retained history is
  summarized, so a large new input cannot bypass compaction and hooks need not be replayed.

### Abort behavior

A running turn's committed partial response is preserved on abort and marked interrupted.
The underlying run normally returns on abort, and the session's post-run check surfaces the abort
error. A concurrent execution-journal failure remains a persistence error; unpersisted output must
not become a committed response merely because cancellation was also requested.

### Tool-result spill store

Oversized tool results are spilled to disk without exposing where or what they are. The store lives in
an unpredictable, owner-only directory (mode `0700`) inside a parent the host supplies and must
supply: a spilled result is conversation content, so it never goes to a directory the store picks,
such as the shared operating-system temporary directory. Each result is written to an exclusively
created `0600` file and addressed by a random, opaque `tool-result:` reference; a store whose sealing
is a sealer writes it sealed and bound to that reference, so the file holds no plaintext and a result
moved to another reference does not open. No path, digest or payload appears in references or
diagnostics, failures carry no secret material, and spilled results are removed on expiry and on
shutdown. They are also removed when the process ends without reaching shutdown, and a directory
whose recorded owner can no longer be alive is removed by the host's next start. The directory
prefix is product-neutral and does not disclose the host product's name.

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
- **The auto-mode classifier judges the call, not the conversation.** Anything the agent read —
  a file, a web page, a tool result — could otherwise argue for its own call, which is the
  injection route the mode most needs to close. It cannot know what the user asked for, so a user
  who wants a blocked call lets it through once or writes a narrow allow rule.
- **Null Object for persistence.** Without a configured store, persistence is silently skipped
  rather than requiring every call site to branch on whether one exists.
- **A record is sealed bound to its own id, one file at a time, and what stays visible is
  stated.** A store that seals writes every record bound to the session it belongs to, and reads
  plain and sealed files alike, so a directory part-way through a migration lists correctly and a
  plain record becomes sealed the next time its session is saved. A file that opens proves it is
  bound to this id and unaltered since it was sealed, and nothing about who sealed it: sealing
  needs only the public key, which any program of the same user can read. So whose a record is is
  decided when its bytes are opened — an authorship tag only unlocked keys make, bytes this store
  wrote from the owner's content, or bytes the owner adopted by their digest — and a save tags only
  content the store can vouch for, never an id a read handed unverified content out for. An owner
  save the locked keys could not tag is tagged at the next unlock only while the store holds the id's
  writer marker or can take it; neither that nor an adoption touches an id another writer holds — a
  process it is lent to, whose saves a changed file would refuse — and neither replaces bytes another
  writer put there since they were read. A write-only child holds the record it was handed as the owner's only when the
  process that handed it over, which holds the keys, held it so. Every store, sealing or not,
  claims the ids its process runs, exclusively across every process and store instance over the same
  files: a claim holds the id's writer marker in a directory beside the records, so a second opener
  anywhere is refused and told which process holds it, and every other write of the id — a save
  without a claim, a delete, an adoption, a tag at unlock — holds the marker for that write. A claim
  fences every save made under it once it is released or its marker is no longer its own; a shared
  operation lock keeps the marker check and record mutation indivisible with respect to cooperating
  forced releases, so a session that lost its marker cannot overwrite the one that took the id next; a read made only to copy a session takes no marker, so a session another process runs
  can still be copied. The marker is a coordination device and never a trust anchor: any program of
  the same user can plant or remove one, so a planted marker denies service until it is released. In a
  store that seals a claimed id is also answered only from the owner's content, so a file something
  unverifiable changed is neither merged into it nor overwritten by it. A sealed file the keys
  cannot open is `locked`, not corrupt: it is intact, and a later unlock reads it; a store that keeps
  its records `'plain'` says so (`no-keys`), since no unlock in its process would open it. It is also not
  listed, since there is no record to describe, so the scan that lists also counts what it left out
  and a surface can say so. Any framing version counts as sealed, so a build never takes a newer
  build's file for plaintext and replaces it; one it does not open reads as written by a build it
  does not read. Locking takes away reading, not saving: a process that is running a session holds
  it in memory and needs only the public key to seal it, so a store remembers, for each session it
  wrote or was asked to hold by a resume or a writer's read, a digest of the sealed bytes and the
  record behind them, and keeps saving that session while the keys are locked for as long as the
  file is provably exactly what it put there. A read that only looks remembers nothing, so it can
  neither push a held session out of that bounded memory nor keep plaintext it was shown. What
  the check stops is a store replacing a sealed session nobody in its process can read, and a file
  that differs from what it remembers is refused as changed. What it holds is memory only, bounded
  except for the sessions it runs, and forgotten on delete. A record
  written for a fork job another process will run is kept apart from it, so a fork never pushes out
  a running session, and is handed over once as a token naming the sealed bytes. Its id is lent to that
  process for as long as it runs, in every store: the lend publishes the writer marker with the digest
  of a nonce only that process is given, which it claims the id with, taking the marker over, and the
  lender ends the lease once the process is gone, whoever holds the marker then — so neither a
  surface nor a second process opens it meanwhile, and it cannot be deleted under that process, whose
  pid a refusal names once it took the marker over; only a session of this store that has not let its
  claim go is a refusal to wait out; a store that cannot
  open the file (a process with only a write grant) takes the token as a record it holds, and a store
  that seals nothing refuses it, since it would write the record in plaintext over the sealed one. Sealing
  protects what is inside the file; file names, sizes and modification times stay visible, because
  the directory is the index and hiding them would take a second index to replace it.
- **An append is one sealed line that opens on its own.** A log or prompt history that seals
  appends each call as one line bound to its kind and owner, so no line needs another to open: a
  reader walking backwards or paging opens only what it shows, writers appending to one file need
  no coordination, and damage stays on its own line. Every sealed append begins and ends with a
  newline, because an append is not atomic and a writer can die part-way: what it leaves becomes a
  line of its own and never swallows the next record, and a final fragment still being written is
  not yet a line. A reader tells a line it read from one that is locked, one that does not open and
  one a newer build sealed; a strict decoder fails on the first it cannot read, and a tolerant one
  counts them. A sealer failing for any other reason is a defect, never a damaged line: a strict
  decoder passes it on as it is. One module decides this for every append store, as one decides it for records.
- **Decoder lives beside its consumers, not beside the type.** The record type is owned by the
  interface package; the decoder is owned here, because an interface package publishes contracts
  and vocabulary, not mechanisms, and every consumer that routes through the decoder — the store,
  the artifact envelope, the replay path — lives in this package or in the layer that depends on
  it.
