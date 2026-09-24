# Agent Core Specification

## Scope

- Owns the core Robota agent runtime, tool integration, conversation execution, and plugin-facing agent behavior.
- Defines the canonical agent orchestration surface used by provider and higher-level packages.
- Provides abstract base classes that provider packages and extensions must implement.

## Boundaries

- Keeps all provider-specific transport behavior in provider packages. Core must not branch on concrete provider names or model names.
- Keeps package-specific domain contracts owned once and reused through public surfaces.
- Does not own workflow visualization or session persistence; session persistence belongs to the session layer.
- **Zero dependency on other agent-\* packages.** `agent-core` must never import any other `@robota-sdk/agent-*` package as a production dependency. This is the foundation of the layered assembly architecture: other agent-\* packages register with agent-core through its abstract contracts; agent-core never depends on them. Plugins were externalized to external plugin packages specifically to preserve this constraint.

## Architecture

Robota is a Facade over a Manager layer (provider registration, tool registry, agent lifecycle, conversation storage, module loading), a Service layer (message handling/LLM calls, tool schema validation and batch execution, unified event emission bound to an owner path), a Permission layer (deterministic policy evaluation for tool calls), a Hook layer (pluggable lifecycle hook execution via a strategy pattern), and a Plugin layer (one built-in event-coordination plugin; all product-facing plugins live in the external `@robota-sdk/agent-plugin` package to preserve the zero-dependency boundary above).

All managers, services, and tools accept dependencies through constructor injection — there are no global singletons, and each `Robota` instance is completely independent. Safe defaults follow the Null Object pattern (a silent logger, a no-op event service), so a caller who wires nothing still gets working, side-effect-free behavior.

## Type and Model Ownership

This package is the SSOT for the core message, provider, permission, hook, context, and interaction contract types that provider and higher-level packages build against; those packages must not re-declare them.

`context/models.ts` is the SSOT for Claude model metadata, and `context/model-pricing.ts` is the SSOT for per-model token pricing (USD per 1,000,000 tokens) so cost-estimating consumers read one table rather than embedding their own.

Model context-window/pricing metadata for OTHER vendors is intentionally not owned here — see "Model Metadata Registry" below.

## Path Containment

The SSOT for "is this path inside that root?" whenever the answer is a security decision. `path.resolve`/`path.normalize` are purely lexical and never consult the filesystem, so they cannot see a symlink: a link sitting inside a root but pointing outside it satisfies a `startsWith(root + sep)` check while the syscall that follows escapes the boundary. Every security-boundary containment check in the monorepo (the file-tool sandbox, the CLI monitor asset server) routes through this module's canonical-path comparison, because two containment checks that can disagree are their own defect.

This is exported from `@robota-sdk/agent-core/node`, not the main barrel: it reads the filesystem, and a barrel carrying it puts `node:fs` in every consumer's static import graph — the import path is where the Node dependency becomes legible.

## Egress Policy

The one outbound boundary for every caller- or model-supplied URL (web fetch, image-edit input fetch, and any future HTTP client a built-in or node runtime adds), exported from `@robota-sdk/agent-core/node` because it needs `node:dns`/`node:net`. It refuses loopback/private/link-local/CGNAT/multicast/reserved destinations for IPv4, IPv6, IPv4-mapped and IPv4-compatible forms — checking BOTH spellings of an embedded IPv4 address (the hex form a URL renders and the dotted form DNS lookups render), because classifying only one spelling leaves the other as a bypass. It also refuses a fixed hostname blocklist (including cloud metadata endpoints) and resolves hostnames, refusing if any answer is private.

Policy outcomes are returned as a discriminated result (`{ ok: false, rejection }`), never thrown; transport errors are thrown as `fetch` throws them. On a cross-origin redirect every caller-supplied header except `User-Agent` is dropped. Known, documented gap: the connection is not pinned to the validated address (Node's global `fetch` offers no connect-time hook without `undici`), so resolve-then-validate per hop narrows the DNS-rebinding window rather than closing it.

## Owner-Only Store

The SSOT for "create this directory or file so only its owner can read it," for every host store under `~/.robota` and a project's `.robota` (session records, logs, settings, device credentials). This module exists because three facts about the Node filesystem API each independently produced a real defect before it did:

- `mkdirSync(path, { recursive: true, mode })` does **not** set the mode of a directory that already exists — it silently adopts whatever is there (measured: a log directory pre-created at 0777 stayed 0777 while its records were 0600, so another account could read, replace, or enumerate records).
- `writeFileSync(path, data, { mode })` applies the mode only when the file is **created** — a record an older version left at 0644 keeps 0644 through every later save.
- Creating a file wide and tightening the permissions afterwards leaves a window where the full record is readable on disk. The module therefore creates with the final mode from the start (atomic `wx`) and never chmods after, so a mutation that removes the mode is caught rather than masked.

Create, set the mode, then **verify** — the verification is load-bearing, not a belt-and-braces extra: it is what catches a filesystem that accepts `chmod` and silently ignores it. Windows cannot express owner-only through `chmod`; the module reports which guarantee (`posix-mode` or `windows-acl`) is actually in force rather than claiming POSIX semantics everywhere, and a project-local `.robota` inside a world-writable directory on Windows is **not** protected by this module. Exported from `@robota-sdk/agent-core/node` for the same reason as path containment: it reads and writes the filesystem.

## Permission Argument Registry

Which argument a tool's permission patterns are scoped to is declared by the tool's own package, not resolved from a hardcoded table of product tool names in this vendor-neutral foundation — a hardcoded table could never know a product's full tool inventory, so an argument-scoped deny for an unknown tool could never match, and a `false` read from a deny list reads as "not denied," meaning the deny silently lost to any broader allow beside it and the invocation was auto-approved.

The argument key is declared together with its **kind** (`path | url | command | text`) as one object, because a single glob syntax served every kind and, for example, a URL pattern that looked like a plain wildcard was actually a wildcard over the whole URL including scheme and host. A bare `*`/`**` pattern matches any invocation for any kind and even for a tool with no declared argument (the preset "match everything" case) — in both directions: a keyless tool under a deny list is now denied where it used to prompt, and under an allow list it is now auto-approved in every mode, where the pattern used to have no effect.

The `command` kind is the only one whose answer differs between the allow and the deny direction. On the allow side, a wildcarded pattern refuses to match across shell separators or substitutions outside quotes (`Bash(git *)` matches `git status` but not `git status; rm -rf /`) — allow is permissive by construction, so it must not accidentally bless a compound line. On the deny side, the same glob is tried against the whole line AND against each command the line runs, because "cannot judge" on a deny must read as "not denied," and a lenient deny match would let a forbidden command hide behind an unrelated one earlier in the line. Both directions honor shell quoting.

A pattern or argument that cannot be evaluated in its declared kind is a distinct outcome from "did not match," and `evaluatePermission` routes an unevaluable **deny** to a prompt (or an outright deny in `plan` mode) rather than falling through to the allow list — the same fail-closed principle as the command-kind asymmetry above, generalized to every kind.

## Model Metadata Registry

Who owns the answer to "how big is this model's context window." This package used to carry a Claude-specific table directly, violating its own no-branching-on-concrete-models rule, and `getModelContextWindow` handed every model NOT in that table `DEFAULT_CONTEXT_WINDOW` (200,000) — which is Claude's number, so every non-Claude session was silently planned against another vendor's context size with no signal that anything was wrong. Model metadata now lives with the package that owns those models (each provider package contributes its own table), and this registry is the ONLY aggregation point — a model nobody registered is a model nobody owns, and the lookup helpers say so explicitly rather than defaulting silently.

## Diagnostic Sink

Where this package's diagnostics go. The internal logger used to fall back to a silent no-op when no sink was passed, but no call site in the repository ever passed one and nothing could install one afterwards — so every diagnostic log call, including failure paths, had no reachable destination; that is not "logging was unconfigured," it could not be configured at all. The default remains **silent**: a library that starts writing to the console just because it was imported is its own defect, so turning diagnostics on must be something a host does deliberately, by installing a process-wide sink. The sink is resolved per call rather than frozen at construction, which is what lets a logger created during module initialization honor a sink installed afterwards.

## Abort Classification

The SSOT for "was this failure an abort?" whenever the answer changes what a caller reports. Several call sites used to decide this by testing the error's message text for the substring "abort," and treated a match as a successfully interrupted run — so a real provider failure whose text happened to contain those letters was reported as a clean interruption, with nothing downstream able to tell the difference. The authoritative signals are the caller's own `AbortSignal` and the error's own `name`, neither of which is a guess about wording. This is exported (not kept private) because more than one layer needs the identical decision, and a private copy is exactly how a wording-based bug survives a fix applied elsewhere.

## Structured Output Schema Conversion (Zod / JSON Schema)

`IParameterSchema` is the one shape every tool schema and every structured-output schema in the repo is expressed in — the same shape describes a root object and every nested node; there is no separate nested form, because splitting the two is what previously let a nested object be emitted as a bare `{ type: 'object' }` while only the root actually named its fields.

- Exactly one of `type` / `anyOf` may be present on a node; emitting both is invalid JSON Schema (a provider applies both constraints and rejects whichever branch fails), and a node with neither is refused everywhere rather than passed silently.
- `additionalProperties` declares closure **relative to a declared `properties` set**: a node that declares `properties` (even an empty one) is closed unless `additionalProperties` says otherwise, while a node that declares no `properties` at all permits any properties, per JSON Schema semantics. The presence of the member, not its emptiness, is what decides — this reflects that the convention was authored for a tool's `parameters` root, where `properties` is always present, so "omitted rejects extras" only ever meant "nothing beyond the declared set" there; carrying that phrasing unchanged onto a nested free-form-object node (which legitimately omits `properties`) would silently give the omitted case a second, unintended meaning.
- Depth is owned by exactly one traversal (`validateAgainstJsonSchema`); a tool's own input validation keeps only its caller-facing leaf error messages and delegates everything with depth to that one function, so the input and output validation paths cannot disagree about the same schema.

Zod-to-schema conversion supports the common constructs (strings, numbers, objects, arrays, enums, unions, records, optional/default/nullable wrappers, refinements/transforms unwrapped at every level). A few choices are deliberate rather than incidental: `ZodNullable` keeps the null half of the accepted type in the emitted schema, because dropping it is a silent rejection of a payload the author's own Zod schema accepts. `ZodNativeEnum` emits only the enum's _values_, not the reverse-mapped names a numeric TypeScript enum also produces via `Object.values`, to avoid advertising an accepted string that the underlying field does not actually accept. `ZodTuple`, `ZodIntersection`, and `ZodLazy` throw at conversion rather than being mapped lossily — the target schema subset has no positional-items, `allOf`, or `$ref` construct to carry them faithfully, and a lossy mapping (e.g. flattening a tuple to "array of any") would silently tell the model a laxer contract than the author wrote. The error names the construct and why, and suggests an alternative Zod expression, so the boundary is discoverable rather than a silent surprise. Zod's three unknown-key modes (`.passthrough()`/default `strip`/`.strict()`) map distinctly to `additionalProperties`; `strip` still emits `true` because the _extra keys are accepted at the boundary and dropped afterward_ by the tool wrapper, not rejected — emitting `false` for it would tell consumers to reject payloads the author's schema actually accepts. A non-object conversion root throws rather than returning an empty schema, because an empty schema reaches the model as "an object, contents unspecified" — exactly the ambiguity this converter exists to prevent.

## Tool Schema Projection

A third-party tool's input schema still has to cross one more boundary before it reaches a provider: each vendor's wire format accepts a different subset (Anthropic: standard JSON Schema with an object root; OpenAI strict mode: every object closed and every property required, optionality expressed as nullable unions; Gemini: an OpenAPI-3.0-shaped subset that cannot carry `additionalProperties` at all). One shared, pure, deterministic projector is used by every provider instead of each reshaping the schema itself; it never throws and never mutates its input, returning one of three outcomes: adopted unchanged (same reference), adapted (a projected copy, with a list of what changed), or rejected (unusable for this provider, with a reason).

Refusals include a non-object root, a dangerous property name (`__proto__`/`constructor`/`prototype`), a cycle, excessive depth or node count, and (depending on the provider's policy) unrecognized keywords or a node declaring both `type` and `anyOf`. Adaptations strip or replace unsupported keywords/members and, where a provider requires it, close objects and force-require all properties (representing an optional field as nullable-and-required instead, since strict mode has no separate optionality channel). When an adaptation removes a _validation_ constraint (something that actually restricts accepted values, e.g. `pattern` or `additionalProperties`) rather than a mere annotation, the tool's description gains one trailing note naming what was not shown to that provider — so a caller can tell, from the schema alone, that a real constraint was dropped for wire compatibility, as opposed to a harmless annotation.

Crucially, a projection changes only what is put on the wire to the provider: the pre-projection, unmodified schema remains what actual tool-call argument validation checks against, so a wire-compatibility relaxation (like the strict-mode nullable compensation) can never widen what the tool call itself is allowed to contain.

## Structured Output Contract

Requesting a schema-validated result returns a validated typed object instead of a string; a streaming run delivers the validated object as the stream's terminal/return value rather than as another delta.

Before the first model call, the resolved provider's capability table is asked which transport can carry the requested schema for _this_ model, and the request is shaped accordingly: a native schema parameter is used when available; a plain "JSON mode" flag is used when the provider guarantees valid JSON but not a specific shape; and when neither exists, the option is omitted from the transport and the schema is instead stated as a system instruction on the very first attempt — so a provider without a schema parameter does not have to spend its first attempt discovering that the target shape was never communicated. A provider that declares no capability table at all is sent the request unchanged: silence about a capability is not the same as a stated absence of it, and treating it as a denial would be an unjustified negative claim.

Endpoint provenance (is this endpoint actually the vendor's own, or a custom base URL that may not honor the vendor's stated guarantees) is tracked as a fact independent of the capability table itself, because a provider can decline to publish a capability table (nobody has verified one) while still needing to report whether it's pointed at a vendor default — folding the two together would force such a provider to either fabricate a capability claim or misreport a gateway as a model that lost a capability.

The final response text is parsed and validated on every run; a validation failure triggers a bounded number of retry turns whose input carries the validation issues alongside the schema, and every attempt (including retry-feedback turns) is committed to conversation history through the standard append-only path — structured output never rewrites history. Exhausting the retry budget throws a dedicated error carrying the validation issues and attempt count. Tools may run within a structured turn; the schema is validated only against the final assistant text once tool rounds complete.

A forced-tool transport (calling a synthetic tool whose parameters _are_ the schema) was considered and deliberately not implemented: it would require a provider that simultaneously lacks a native schema parameter AND has enforceable strict-tool-argument support, and across this workspace that intersection is empty — introducing a union branch nothing can produce is a case every consumer would have to handle and no test could exercise.

## Tool Residency and Tool Search

Historically every registered tool's full schema was put in front of the model on every request, with no way to load one on demand as the tool count grew. Residency changes that: a tool schema is either **resident** (always offered — the default, so every schema that existed before this contract is unaffected) or **deferred** (withheld from the request until a search tool loads it), and the set actually sent on a given request is what's **offered**.

Deferral here is stronger than the vendor feature of the same name: a vendor's native "defer loading" keeps a definition out of the model's visible context while the request still carries every schema server-side, because the vendor's own search needs them there. This implementation withholds the schema from the outbound request entirely, so both wire bytes and context tokens actually fall, and the same behavior works uniformly across every provider — including ones that document no comparable native feature — because the model-visible search mechanism is just an ordinary function tool over a catalog this package owns.

Two invariants are enforced, both refused rather than silently repaired: at least one tool must remain resident (a configuration that defers everything offers the model nothing to call and nothing to search with, mirroring a vendor's own rejection of the same configuration), and if deferral is engaged and at least one schema is actually withheld, the request must also offer a tool search tool — a deferred tool with no loader is unreachable, and the policy refuses that outcome rather than leaving it silently unreachable.

The offered tool list is read fresh on every round rather than snapshotted once per run, which is what makes "a tool loaded by round N is usable in round N+1" possible at all. Deferral engages automatically only past a threshold (either a deferrable-tool count or an estimated-schema-token share of the model's context window), not unconditionally, so a small tool set is completely unaffected and a growing one switches on with no explicit flag day; an explicit configuration setting always overrides the automatic threshold. Deferral never widens authority: the permission gate decides by tool name only and never consults residency state, so a permission rule has the same effect whether its tool is currently loaded or not.

## Disposal Contract

Every disposal surface in the stack follows one convention: disposal is **best-effort** and never rejects for a cleanup failure, so a fire-and-forget disposal call is always safe (a rejection there would otherwise be an unhandled rejection capable of killing the host process). Every cleanup step runs regardless of an earlier step's failure; each failure is recorded and returned to the caller rather than thrown, and state is always reset. Operation-style closes that a caller directly acts on (as opposed to teardown) are the deliberate exception and keep throwing, because their errors are answers the caller needs, not cleanup noise to be collected.

At the agent level specifically: destruction awaits the run-queue tail so in-flight and already-queued runs settle first, then disposes plugins and modules and resets state. Once destruction is initiated the instance is **terminal** — new runs are rejected and re-initialization is impossible, but repeated destroy calls are idempotent. A failed (not yet successful) initialization is NOT cached as a permanent failure, so a caller can retry construction-time setup before the instance is actually destroyed. After shutdown completes, the agent must hold no live timers or listeners; an undisposed resource that keeps a process alive is a contract violation, not a cosmetic leak.

Plugin resource cleanup follows the same single entry point (`dispose()`, not an ad hoc `destroy()`), and a plugin owning timers, sockets, or storage handles must override it to release them. A plugin's own handler failures must never take down the host process: by default a throwing handler is recorded and swallowed rather than rethrown, and any background flush the plugin schedules must attach its own rejection handler — a bare unhandled promise there is exactly the kind of process-killing failure this contract exists to prevent.

## Permission System

Deterministic, four-step policy evaluation, consumed by the session layer to gate tool execution before delegating to the actual tool:

1. **Deny list match** — any matching deny pattern returns `deny` immediately.
2. **Deny list unevaluable** — if a deny pattern is argument-scoped and either no owner has declared which argument this tool's patterns are about, or the argument/pattern cannot be interpreted in its declared kind, the deny cannot be evaluated and the gate prompts (or denies outright in `plan` mode) rather than continuing to the allow list. This is the fail-closed complement to step 3: an unevaluable deny must never be treated as "no deny applies."
3. **Allow list match** — any matching allow pattern returns `auto` (proceed without prompting).
4. **Mode policy lookup** — falls back to the tool's declared risk class (`inspect`/`modify`/`execute`) crossed with the current permission mode. A tool whose owner declared no risk class prompts and is refused outright in `plan` mode, rather than defaulting to permissive — an unclassified tool must be at least as cautious as a hand-classified risky one.

The risk-class-to-decision matrix intentionally names no concrete product tool: read-only tools auto-proceed in every mode including `plan`; write and shell-execution tools are denied in `plan`, prompt in `default`, and only shell/execute-class actions still prompt in `acceptEdits` (write actions become automatic there); everything is automatic only under the most permissive mode. This vendor-neutral foundation cannot know a product's full tool inventory, so classification is declared by the package that defines each tool, not read from a hardcoded name table here — a hardcoded matrix previously drifted from the actual tool set and left newly produced tools prompting (or refused in `plan`) by default until their owner declared a class.

## Hook System

A pluggable lifecycle hook mechanism supporting multiple execution strategies (shell command, HTTP, and, in higher layers, LLM-prompt and sub-agent delegation).

**Outcome contract.** A hook executor returns a decoded three-way outcome — `allow`, `deny`, or `error` — rather than a raw exit code or HTTP status. `error` is the _absence_ of a verdict, not a third verdict, and carries a reason for why no verdict could be decoded. This distinction exists because the previous shape had no channel for "the hook itself failed," so every failure was coerced into a verdict by ordinary truthiness: a malformed non-boolean field could read as approval and silently disable the gate, while a missing field could read as denial and block a tool call no hook had actually objected to. A decoded body is trusted only when its verdict field is exactly `true` or exactly `false`; an explicit block directive stated elsewhere in the same body is honored even alongside an otherwise-undecodable verdict field, because that directive is a decision the hook stated outright and an undecodable field beside it does not retract it.

**Per-event enforcement posture.** Whether an `error` outcome actually blocks the operation is a _per-event_ policy, not a blanket rule — recorded event-by-event, together with whether that event's call site is even capable of honoring a block (many fire sites do not await the hook result or do not inspect it). Only the event whose fire site both awaits and inspects the result is allowed to enforce; asserting "enforcing" for an event whose fire site can't act on it would flip a row that changes nothing while reading as though a gate had been switched on. In this codebase, tool-use gating is the sole event that fails closed on an undecodable hook result; every other lifecycle event is advisory. A single published predicate answers "does this event enforce," so no consumer re-derives the rule from the table and risks disagreeing with it.

**Command hook exit-code mapping.** A command hook's exit code is one _input_ to the outcome decision, not the decision itself: exit 0 is `allow` (with stdout carried through), exit 2 is `deny` (with stderr as the reason), and every other exit code, a signal kill, a timeout, or a process that never started is `error` with a specific named reason (never silently coerced to `allow` or `deny`).

## Cancellation Contract

A run's cancellation signal is the single source of cancellation for that run, and gates identically across every entry point into a turn — there is no second, cancellation-blind execution path. It reaches every provider call including abnormal ones (e.g. a forced end-of-round summary call goes through the same signal-carrying path as a normal round call), every tool execution (a long-running built-in tool MUST observe the signal and terminate its own work rather than completing silently after abort — silent completion after abort is a contract violation), and a streaming consumer that abandons its generator early also aborts the underlying turn, since a turn that keeps writing to history after its only reader left is worse than one that was cleanly cancelled. An aborted run always resolves as "interrupted," never as a provider error and never as an ordinary successful completion. By default cancellation can complete before the provider call settles; a host may opt into joining provider settlement so completion also releases ownership of that call, accepting that a provider which ignores abort can keep the run pending. A late provider result or rejection never replaces the cancellation or timeout that won.

## Reasoning Effort

A provider-neutral effort vocabulary (`none` through `max`, plus an `auto` selection state that is NOT itself a native provider control) that adapter packages resolve against their own source-dated, per-model capability tables — this package supplies no vendor defaults or field names. Resolution yields one of a small set of dispositions (applied exactly, clamped downward, fell back to the model's own default, or not applied at all) plus an immutable audit record, and the terminal outcome separately records whether a native control was actually sent to the provider and whether a provider dispatch occurred at all — a cached or otherwise no-dispatch response can never claim to have applied a native effort control, which matters for anything auditing what was actually sent on the wire.

The model-configuration read/write API (getting or setting the active model) is answerable immediately after construction, without requiring the agent's async readiness to complete first: the state it reads (provider registry, current provider/model pair) is established synchronously in the constructor from already-validated config, because forcing a caller through the async initializer just to ask "which model is this?" made no sense. A destroyed agent reports its own teardown as teardown (a specific disposal-check message), not as "not yet initialized" — those are different failures and conflating them previously sent an unrelated investigation looking for a missing `await` that did not exist.

## Provider-Native Replay Payloads

Provider packages own their native SDK request/response/stream objects and report them through a provider-neutral callback bridge for replay-grade session capture; this package must not import concrete provider SDK types, inspect provider identity, or choose provider-specific payload fields — a provider names itself and its own API surface as opaque strings, and this package only wraps the callback, assigns a stream-order fallback when a provider omits one, and stamps the current execution/conversation/round identity onto the emitted event.

## Trusted Trace Context

A run carries W3C trace context only when its host supplies it; this package never adopts ambient trace state. Every call actually handed to a provider — the forced summary included, cache hits and refused preflights excluded — carries a `traceparent` whose span is derived from that call's own ID by the same function the exporter uses, so the parent a vendor sees is the span the trace contains. It is resolved at invocation, after the request was announced, so no replay event contains it. A provider that does not affirmatively declare it can propagate receives nothing and the host is told which provider, by ID only. An adapter sends the header only when its effective origin exactly equals a host-listed origin, because the header discloses trace identifiers to whoever receives it.

## Provider Contract — Dual Surface (Intentional)

Every provider implementation deliberately exposes two request/response surfaces: a universal, public surface (`chat`/`chatStream`, operating on the package's normalized message type) that generic layers and SDK consumers use, and a raw, internal-protocol surface used only by this package's own conversation service to thread provider-native request/response payloads for replay capture. The two live on one interface because a provider instance is legitimately both at once; the raw methods are an internal-protocol detail, not a second public API, and only the conversation service is meant to drive them.

## Usage-Triple SSOT

The prompt/completion/total token-usage shape is owned once in this package; no package may re-declare that shape — every occurrence elsewhere in the monorepo is either a direct reference or a named alias of it, never an independently declared lookalike.

## Provider Capabilities

Generic layers must query a provider's capabilities through one function rather than branching on provider identity. Provider-native "web tools" (server-side search/fetch) are a distinct concept from this package's own local function tools of the same name: a provider can _support_ a native web capability without that capability being _enabled_ for a given instance, and requesting a native web tool for one call must be checked and rejected before transport execution when the provider doesn't support or hasn't enabled it — failing before any network activity starts, not partway through a stream.

For model-level (rather than provider-level) capabilities, a model's capability table is asked before falling back to the vendor's stated default, and a capability the catalog has said nothing about is reported as genuinely unknown rather than coerced into `false` — silence about a capability is not a denial of it, and callers that need to act on silence must state their own assumption explicitly rather than have one assumed for them.

## Context Window Tracking

Effective context-token usage is estimated as the maximum of a deterministic serialized-history estimate and the latest exact provider-reported usage (plus an optional caller-supplied floor) — never the sum of historical provider usage across turns. This specifically prevents two failure modes: an old provider usage number masking a large metadata-free prompt that arrived afterward, and multi-turn provider input counts being double-counted by summing what each call already reported cumulatively. Provider-reported usage is normalized into one canonical metadata shape before an assistant message is committed, and each provider round is tagged with a fresh observation identity so streamed fragments of the same round can be deduplicated by identity rather than by comparing token counts.

## Class Registry and Cross-Layer Ports

Provider packages implement this package's provider base class; other layers extend its abstract executor, plugin, module, and tool base classes; and `agent-core` in turn owns the neutral multi-agent orchestration contracts (primitives, step/spec shapes, and their lifecycle event names) as pure, runtime-free type contracts — a separate, higher `agent-framework` layer implements the actual orchestration mechanism over them. These contracts carry no application-domain identity by design and are enforced neutral by a standing repository scan; if a second independent implementer of them appears, both the contracts and their event-type unions are meant to move out into their own dedicated package rather than staying bundled here.

## Event Architecture

Events are named `ownerType.localName` (e.g. an execution-service event, a tool-execution event, an agent-level event) and each event carries an owner-path trace of the execution hierarchy that produced it, so a consumer can reconstruct which agent/tool/execution nesting emitted a given event without a separate correlation mechanism.
The tool-body completion name identifies only the awaited body of a permitted call. A consumer must
not interpret pre-execution permission or hook failures as executed tool spans.

## Conversation History Principles

- **Append-only**: messages are only added, never edited or deleted.
- **Read-only for consumers**: readers must not mutate existing messages.
- **Always committed**: the begin/commit assistant-message protocol guarantees an assistant message is always appended, even on abort with empty content — there is a single commit path, not a branch between normal completion and abort.
- **No fallback**: if a message should be in history, it IS in history; there is no silent fallback to an alternative data source.
- **Unbounded by default**: history is never trimmed by message count unless a host explicitly configures a cap.

Only assistant messages may ever carry an "interrupted" state (indicating the response was aborted before natural completion); user/system/tool messages are always complete. When history is read back for a provider API call, an interrupted assistant message's text is annotated so the model itself understands its own previous response was cut short, rather than presenting a truncated response as if it had ended normally.

## System Prompt

The system prompt is the agent's live instruction state, not ordinary conversation content — the append-only/read-only history principles above govern user/assistant/tool messages but deliberately do not govern the system prompt, which is replaceable.

- **Single owner, single head message**: the system prompt has exactly one source of truth in the agent config, and a conversation store holds exactly one system message, always at the head; setting it removes any existing system messages first.
- **Injected once per session, then reused as-is**: the prompt is injected into a session's log only when that log has no system message yet (session start, or the first turn after resume); on every later turn within that session the log is reused unmodified — the prompt is never re-derived or re-attached per turn, because once a prompt has been sent it is part of that session's own record.
- **Live updates propagate immediately**: updating the system prompt updates both the config and the live conversation-store head in place, so the very next provider request carries the change — this is the path that lets a session's persona or environment-staleness refresh reach the model as an infrequent, deliberate mutation, not a per-turn rewrite. Updating only the config field without the store head is insufficient, because providers read the system prompt out of the message array, never from a side-channel config field.
- **Resume does not replay a stale prompt**: a persisted system message from a previous session is not restored verbatim; instead the current live prompt is injected fresh on the first turn after resume, so a resumed session reflects the current environment rather than a stale snapshot, while the substantive user/assistant/tool history is always preserved regardless.

This zero-dependency foundation layer injects no persona or product vocabulary into the model on its own — every string it can place in front of a model (default system message, a context-capacity notice, a tool-result-skip notice, a forced-summary instruction) defaults to empty or strictly neutral mechanism text, with an explicit override seam for a product layer that wants its own wording. Any new model-facing string added to this package must default to neutral text and, where appropriate, expose such a seam — this is a standing design rule, not a one-time inventory.

## Provider Tool-Call ID Ownership

Provider adapters own the tool-call identifier value; this package treats it as an opaque transcript token linking an assistant tool call to its corresponding tool result message, never as a value it mints or rewrites. Conversation history must not require these IDs to be unique across a whole conversation, because some providers legitimately reuse the same ID value across separate turns — any internal subsystem that needs a truly unique identifier must mint its own internal ID rather than repurposing the provider's transcript token for uniqueness it was never designed to guarantee.

## Unavailable Tool-Call Handling

Provider adapters must pass through a provider-native tool call even when its name is not locally registered — the execution decision belongs to this package, not the adapter. An unrecognized tool name is never executed and never silently aliased to a different registered tool; it is recorded as a distinct, explicitly labeled skip (naming the requested tool and what is actually available) rather than a generic failure, is not counted as an executed tool, and is reported with the same detail through replay events so downstream consumers can explain the skip. If unavailable tool calls repeat across consecutive rounds, a loop guard stops normal tool rounds and forces one final call without tools, whose instruction explicitly names which tool calls were never executed. Product layers must not paper over a naming mismatch with an ad hoc alias table — the correction path is making the tool visible and let the model's own error feedback loop correct itself.

## Run Concurrency Contract

A single agent instance owns one conversation history, so concurrent executions on the same instance would otherwise interleave history writes. Runs on one instance are therefore serialized through a single FIFO slot: a call made while another run is in flight waits for the earlier run to finish and then executes with a strictly sequential history, without requiring the caller to do any external locking. A streaming run holds the slot only once its consumer actually begins iterating (an abandoned, never-consumed stream never acquires it) and releases it whether the stream completes naturally or is closed early by its consumer. A queued call whose cancellation signal is already set by the time its turn arrives fails immediately without ever touching the provider or history, which is a different failure mode from cancelling an already-in-flight run (which instead resolves normally as interrupted, per the cancellation contract above). This serialization is strictly per-instance; separate instances remain fully concurrent with each other.

If a run is aborted mid-stream, partial content already produced is preserved in history through the same single commit path used for a normal completion (marked interrupted rather than complete), any tool calls already in flight when the abort landed still complete and record normal results, and any tools still queued behind them are skipped with an explicit "interrupted by user" result rather than silently vanishing — both outcomes are recorded, so a reader of history can see exactly what ran and what didn't.

## Execution Loop and Error Handling

Each attempted provider round, including a forced-summary call, emits one content-free completion observation with its actual
start/end time, round number, and success/failure/interruption outcome. It describes the shared
provider-call boundary (which may be served from cache), not proof of an outbound network request;
request and response bodies belong only to their existing separate execution events.

The default round budget for one run is a fixed number of model/tool rounds, overridable per-run or per-config (run-scoped values win); a budget of zero disables the round cap entirely and leaves stopping to abort, the context-window guard, and provider timeouts.

A run-scoped `toolChoice: none` omits local tool schemas from every ordinary provider round. If a provider nevertheless returns a tool call, the run fails before any tool body starts; the directive is not a substitute for provider-side hosted-tool suppression or for restrictions on trusted hooks and plugins. A later run without the override retains its configured tool policy.

**Identical-tool-input guard.** A configured limit on repeated byte-identical invocations of one tool within a single run exists as a distinct, _named_ error rather than a generic abort, and this distinction is deliberately behavioral, not cosmetic: this package's own abort-classification logic resolves an `AbortError` as "the caller asked to stop, and got a successful, cleanly interrupted result" — but when a run gives up because it detected a pathological identical-input loop, nobody asked it to stop; the agent failed to make progress. Reporting that as a clean interruption would misreport a stuck agent as a successful outcome, so the guard raises a specifically named, recoverable error that a caller can distinguish from both a real abort and an unrelated system failure.

When the round budget is exhausted without a final assistant text response, one forced summary call is made with `toolChoice: none` and without local tools, including provider-hosted tools that honor that directive. Returned tool calls are not dispatched; if the call produces no text, a fixed fallback message is returned instead of an empty response. The synthetic instruction used to request that summary is a per-call prompt artifact only — it is never written into the persisted conversation history.

**Pre-send context guard.** Before every provider call, estimated token usage is checked against the model's context window; this is a hard-capacity stop (distinct from — and does not replace — the session layer's own configured automatic-compaction policy) and only trips when usage exceeds a high fixed threshold of the window, at which point it emits a diagnostic message explaining why the prompt was blocked rather than sending a request likely to fail with a provider-side size error.

**Provider call failures are surfaced, not swallowed.** If a provider call throws, the error is recorded as a readable assistant-visible message rather than the caller seeing an opaque "no response received," and if the whole execution pipeline throws unexpectedly, it is still caught and turned into a graceful error result rather than propagating an unhandled rejection.

**Tool-result context budget.** Once history's context estimate crosses a high fixed threshold while committing a batch of tool results, remaining results in that batch are replaced with a short, fixed context-error message instead of their real content (mirroring the same pattern used for a permission deny) — the execution loop does not stop; it continues so the model can see the mix of real and skipped results and decide how to proceed with what it has.

## Class Extension Points

Provider, tool, plugin, module, executor, and storage integrations each extend a corresponding abstract base class or implement a corresponding port interface; a concrete implementation must fulfill that base class's documented lifecycle contract (e.g. a provider must implement both its chat and streaming-chat methods) to be usable by the rest of the runtime.

## Error Taxonomy

Most errors this package raises extend one base error class carrying a machine-readable `code`, a `category` (user / provider / system), and a `recoverable` flag, so a caller can branch on failure kind without parsing message text. Some classes extend `Error` directly (tool-result admission refusals, owner-only-store mode errors), and some internal failures are thrown as plain `Error` with no code or category.

## Canonical Direct Runtime Tool Invocation

An agent's registered tool catalog (including currently-deferred tools) can be invoked directly through the same execution path a model-driven tool call uses — the same validation, permission-wrapped execution, and event emission — without fabricating a model turn or requiring the model to have discovered a deferred tool first. Direct invocation does not bypass configured tool allowlists or permission enforcement, and it does not inject an interactive "ask the user" handler the way a live model-driven session might.

## Extraction Trigger

The neutral orchestration contracts (see "Class Registry and Cross-Layer Ports" above) are intentionally light — pure types with no runtime and no application identity — because they exist to let exactly one implementer (`agent-framework`) build the actual mechanism without this foundation depending on it. If a second, independent implementer family appears, that is the trigger to extract both the contracts and their event-type unions into their own dedicated package rather than continuing to host them here.
