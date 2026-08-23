---
status: done
type: DATA
tags: [session, persistence, codec, contract, decoder]
---

# TRANS-005: the persisted interactive-session record has no total runtime decoder

Design for Task
[`.agents/tasks/completed/TRANS-005-versioned-total-decoder-for-the-persisted-session-record.md`](../../tasks/completed/TRANS-005-versioned-total-decoder-for-the-persisted-session-record.md),
the execution leaf [issue #2081](https://github.com/woojubb/robota/issues/2081) under tracker
[issue #2067](https://github.com/woojubb/robota/issues/2067).

## Problem

`IInteractiveSessionRecord` (`packages/agent-interface-transport/src/session-contracts.ts:447`) is a
persisted and transferred shape that exists only at compile time. Every ingress casts into it instead
of decoding it.

**Symptom 1 — a cast produces a value whose runtime type contradicts its declared type.**
`NodeSessionStore.load` is `JSON.parse(raw) as IInteractiveSessionRecord`
(`packages/agent-session/src/session-store.ts:91`). The contract declares
`messages[].timestamp: Date` and `history[].timestamp: Date` (`IBaseMessage` / `IHistoryEntry`,
`packages/agent-core/src/interfaces/messages.ts:66,120`), but JSON has no date type, so a loaded
record carries **strings** in both. No revival step exists anywhere on the load path:
`WorkspaceSessionStore.load` forwards the store result unchanged
(`packages/agent-framework/src/interactive/workspace-session-store.ts:55-63`), and the only
`new Date(...)` calls on that path re-parse `updatedAt` for sorting — never the message or history
timestamps.

Reproduction condition: resume any persisted session (`--resume` / `--continue`) and reach a consumer
that treats the declared type as true. `createMainThreadDetailPage` calls
`entry.timestamp.toISOString()`
(`packages/agent-framework/src/background-tasks/execution-workspace-detail.ts:19`) and
`interactive-session-workspace.ts:51` calls `history.at(-1)?.timestamp.toISOString()`. On a resumed
record `entry.timestamp` is a `string`, and `String.prototype.toISOString` does not exist — a
`TypeError` at the render, not at the load.

**Symptom 2 — corruption is indistinguishable from absence.** `NodeSessionStore.load` catches every
failure and returns `undefined` (`session-store.ts:92-95`, carrying an explicit
`// allow-fallback:` marker), and `NodeSessionStore.list` skips unreadable files silently
(`session-store.ts:114`). `WorkspaceSessionStore.load` falls through to log replay when the parse fails
(`workspace-session-store.ts:63`), which reconstructs a _partial_ record —
`skillActivationEvents: []`, no `goal`, no `plan`, no `activeBranch`, no `toolSchemas`
(`workspace-session-store.ts:106-107`). A truncated session file therefore resumes as a silently
field-stripped session rather than as an error.

**Symptom 3 — a parseable wrong shape is accepted everywhere.** The artifact decoder validates the
envelope version and then only that the record is a non-array object with a string `id`
(`packages/agent-session/src/session-artifact.ts:69-81`); every nested field is unchecked. The
handoff destination verifies byte integrity and then casts
(`packages/agent-framework/src/handoff/handoff-destination.ts:82-111`) — integrity is not schema
validity.

No component owns "is this a valid record?", so four ingresses answer it four different ways and
none of them answers it completely.

## Prior Art Research

**Question.** When a product persists a rich, nested session/checkpoint state and reads it back later,
how does it (a) version the persisted shape, (b) decide what to do with data it cannot decode, and
(c) tell the caller _where_ the decode failed?

**Zod — field-path diagnostics are a path array, not a message string.**
[Zod's error-formatting documentation](https://zod.dev/error-formatting) specifies that every issue
carries a `path` array locating the failure inside the validated structure: an error at index 1 of
`favoriteNumbers` reports `path: ['favoriteNumbers', 1]`, and a top-level error reports `path: []`.
Zod additionally ships three _renderings_ over that one structure — `z.treeifyError()` (a nested
object mirroring the schema), `z.prettifyError()` (a human string, `→ at favoriteNumbers[1]`), and
`z.flattenError()` (shallow `formErrors` / `fieldErrors`). **Constraint that applies to Robota:** the
machine-readable location and its human rendering are separate concerns; a decoder should emit a
structured path and let a consumer render it. A decoder that returns only a prose message cannot be
consumed by a store that must classify the failure.

**LangGraph checkpointers — serde is a named protocol, and the fallback is opt-in.**
[LangChain's checkpointer documentation](https://docs.langchain.com/oss/python/langgraph/checkpointers)
defines a `SerializerProtocol` whose `dumps_typed` returns a **type identifier plus** the binary blob,
so the persisted bytes never travel without a declaration of what they are. Support for types outside
the serializer's own vocabulary is not implicit: it requires the explicit `pickle_fallback` argument
of `JsonPlusSerializer`. **Constraint that applies to Robota:** the version/type tag belongs _with_
the persisted bytes rather than being inferred by the reader, and a permissive path must be something
a caller opts into by name — which is the opposite of `session-store.ts`'s unconditional
`catch { return undefined }`.

**Protocol Buffers — a version boundary is what makes "unknown" recoverable.**
[The proto3 language guide's schema-update rules](https://protobuf.dev/programming-guides/proto3/#updating)
make additive change safe _because_ the wire format is versioned by field number and readers preserve
unknown fields; the same document is explicit that renumbering fields and reusing deleted field
numbers produce "ambiguous" decoding, and that unknown fields are **lost** when serializing to JSON.
**Constraint that applies to Robota:** the persisted format here _is_ JSON, so the forward-compatible
"preserve what you do not understand" property protobuf relies on is not available. With no
compatibility requirement (the audited API is prerelease, per issue #2079), the correct reading of that
constraint is the strict one — reject a shape this build does not understand and say so, rather than
decode what is recognised and silently drop the rest, which is exactly Symptom 2.

**No comparable reference found** for the specific case of a _TypeScript-interface-only_ persisted
contract regaining a runtime decoder without adopting a schema library; the three references above
constrain the design, they do not supply it.

## Architecture Review

### Affected Scope

- **Type owner:** `packages/agent-interface-transport` declares `IInteractiveSessionRecord` and every
  nested contract except `TUniversalMessage` / `IHistoryEntry` / `IToolSchema` (`agent-core`). It is
  **not** written by this leaf — see the amendment in Decision below.
- **Codec owner (this leaf's package):** `packages/agent-session`, which already owns the persistence
  paths that will consume the decoder and already depends on both contract packages.
- **Files this leaf writes:** a new `src/session-record-codec/` module directory under
  `packages/agent-session`, one export block in that package's `src/index.ts`, one new test file
  under its `src/__tests__/`, and its `docs/SPEC.md`.
- **Files this leaf does NOT write:** every consumer, and the contract package. `session-store.ts`,
  `session-artifact.ts`, `handoff-destination.ts`, and `workspace-session-store.ts` are migrated by
  issue #2096, issue #2097 and issue #2098 and are untouched here, per issue #2081's scope boundary.
  `packages/agent-interface-transport/` is byte-identical to the integration branch.
- **Lane boundary:** issue #2080 (robota-2) owns `.agents/project-structure.md`, the architecture map,
  and the dependency-direction docs, and states "No production TypeScript is moved in this issue".
  After the amendment this leaf does not enter that package at all. Within `agent-session`,
  `src/__tests__/` is shared with the hooks leaf (issue #2083) by directory but not by file; no
  `package.json` change is needed, because the dependencies this codec imports are already declared.
- **Nested contracts that must be decoded totally:** `TUniversalMessage` (4 variants),
  `TUniversalMessagePart` (3 variants), `IToolCall`, `IHistoryEntry`, `IToolSchema` /
  `IObjectParameterSchema` / `IParameterSchema`, `IBackgroundTaskState` (+ `IBackgroundTaskResult`,
  `IBackgroundTaskError`, `IBackgroundTaskSchedule`), `TBackgroundTaskEvent` (12 variants),
  `IBackgroundJobGroupState` (+ `IBackgroundJobResultEnvelope`), `TBackgroundJobGroupEvent`
  (3 variants), `ISkillActivationEvent`, `IMemoryEvent`, `IMemoryReference`, `IContextReferenceItem`,
  `IGoalState` (+ `IGoalProgressEntry`), `IPlanArtifact` (+ `IPlanStep`), `IActiveBranchPointer`.

### Alternatives Considered

**A. Hand-written total decoder inside the contract package (chosen).**

- Pro: no dependency edge added — the `deps` scan fails any `agent-interface-*` package whose
  internal dependencies exceed `{agent-core}` (this package's SPEC, "Boundaries"), and a hand-written
  decoder adds none.
- Pro: the decoder sits with the type it decodes, so there is exactly one owner, which is the property
  issue #2067 exists to establish.
- Pro: precedent already exists in this package — `isTransportRunOutcome(value: unknown)`
  (`transport-adapter.ts:101`), `isHandoffCommitted`, `sourceRetainsAuthority`, `isTurnNotRunError` —
  so a pure, class-free, I/O-free runtime guard is an established member of its surface, not a new
  kind of thing.
- Con: the decoder must be maintained by hand alongside the interfaces; a field added to a contract
  and not to its decoder is a silent gap. Mitigated by TC-09 (a key-parity test that fails when the
  two disagree), not by discipline.
- Con: volume. The record reaches ~20 nested contracts, which cannot fit the 300-line production file
  limit (`scripts/harness/scan-file-size.mjs`, `MAX_LINES = 300`) in one file — it needs a module
  directory, which is more structure than a one-file decoder.

**B. Declare the shapes with Zod and derive the decoder.**

- Pro: dramatically less code, and field-path diagnostics come free in exactly the form the research
  above endorses.
- Con: **mechanically refused.** It adds `zod` to an `agent-interface-*` package, which the `deps`
  scan fails; zod today is a dependency of `agent-framework`, `agent-core`, `agent-cli`, `agent-tools`
  and the dag packages — never of a contract package.
- Con: it creates a second source of truth. The TypeScript interface and the Zod schema would both
  describe the record, and nothing would force them to agree — the same class of drift as A's con,
  but without A's key-parity test being possible, because the schema _is_ the type.

**C. Put the decoder in `agent-session` instead.**

- Pro: `agent-session` already depends on the contract package and already carries validation code
  (`session-log-validation.ts`), so no interface-package question arises at all.
- Pro: reachable by every currently-known consumer — `agent-framework` depends on `agent-session`.
- Con: it splits the decoder from the type it decodes, which is the defect issue #2067 names, and
  contradicts that tracker's stated direction ("the session contract owner provides
  `decodeInteractiveSessionRecord`").
- Con: it is not reachable by every consumer of the _type_. `agent-transport-protocol`,
  `agent-session-analytics`, and `agent-transport-tui` all reference `IInteractiveSessionRecord`
  without depending on `agent-session`; placing the decoder there would put the type in one package
  and its only validator in a package they cannot import.

**D. Generate decoders from the TypeScript types at build time.**

- Pro: no hand-maintenance, no second source of truth — the interface stays authoritative.
- Con: it introduces a code-generation step and a generator dependency into a package whose entire
  contract is "contracts plus pure dependency-free accessors", and puts generated code in the
  published surface. That is a practice this repository has not used before, which is explicitly a
  stop-and-ask class under `backlog-execution.md`.

### Decision

**Alternative C, hand-written (the decoder shape of A, in the package of C).**

> **AMENDMENT — 2026-08-23, after implementation and before the pull request.** This section
> originally chose alternative A and was approved as such. That choice was WRONG, and the correction
> is recorded here rather than quietly applied, because GATE-APPROVAL had already been recorded
> against the superseded text. The superseded decision read: _"Alternative A. … Between A and C the
> deciding fact is not style but reachability — three packages consume `IInteractiveSessionRecord`
> without depending on `agent-session`, so C would ship a contract whose validator half its consumers
> cannot reach."_
>
> **What refuted it.** `pnpm harness:scan` carries `scan-interface-runtime`, which freezes the number
> of runtime MECHANISMS an `agent-interface-*` entry may publish (`agent-interface-transport`: 5,
> `scripts/harness/interface-entry-baseline.json`). Its failure text states the rule and its remedy:
> _"An agent-interface-\* package publishes contracts, its vocabulary and its discriminators — not
> mechanisms. Move it to an owner package."_ A decoder is a mechanism. So the same class of
> mechanical constraint that made alternative B unavailable makes alternative A unavailable, and the
> Architecture Review missed it — the alternatives were checked against the `deps` scan and not
> against this one.
>
> **The reasoning error, named.** The reachability argument that rejected C is true about the TYPE
> and was allowed to stand for the DECODER without being re-tested. They are different populations:
> `agent-transport-protocol`, `agent-session-analytics` and `agent-transport-tui` consume the record
> TYPE without depending on `agent-session`, but none of them decodes one. Every actual and planned
> consumer of the DECODER — issue #2096, issue #2097, issue #2098 — is in `agent-session` or in
> `agent-framework`, which depends on it. C is reachable by all of them.
>
> **What was NOT done, deliberately.** The frozen allowance was not raised. A guard whose failure
> text says "move it", answered by editing that guard's baseline, adopts exactly the debt the guard
> exists to refuse; `rules/index.md` binds a rule until it is amended, and an argument against one is
> the input to an amendment rather than an exemption from it.

The decoder's SHAPE is alternative A's — hand-written, no schema library — and its PLACEMENT is
alternative C's. The trade-off that decides the shape is dependency direction against authoring cost:
B is the better _code_ and is unavailable, because it adds a dependency that `agent-session`'s own
boundary does not want and that would make the schema a second source of truth beside the interface.
A's maintenance con is answered mechanically by TC-09 rather than by care.

Three things the corrected placement improves rather than merely satisfies: the codec lands beside
`session-store.ts`, `session-artifact.ts` and `session-log-validation.ts` — the very files
issue #2096/#2097/#2098 migrate; the contract package's published surface is untouched, so no
`export *` and no barrel-size exemption are needed; and `packages/agent-interface-transport/` ends
this leaf byte-identical to the integration branch.

**Shape of the decision, and what each part answers:**

1. **Outcome, not exception.** `decodeInteractiveSessionRecord(value: unknown)` returns a
   discriminated outcome — `valid` / `corrupt` / `unsupported` — rather than throwing or returning
   `undefined`. `missing` is deliberately **not** a member: absence is a property of a store, not of a
   value, and issue #2096 composes the store's `missing` with these three. Returning `undefined` for a bad
   value is what created Symptom 2, so the type makes that spelling unavailable.
2. **Version travels with the bytes, not in the reader's head.** `INTERACTIVE_SESSION_RECORD_VERSION`
   plus an `IVersionedInteractiveSessionRecord` envelope (`{ schemaVersion, record }`), and
   `decodeVersionedInteractiveSessionRecord` returns `unsupported` — carrying the version it actually
   saw — when the envelope names a version this build does not implement. This follows the LangGraph
   constraint. The bare-record decoder stays exported for callers that have already unwrapped an
   envelope.
3. **`schemaVersion` is NOT added to `IInteractiveSessionRecord`.** Making it a required member would
   force every producer to set it, and migrating producers is out of scope for this leaf by issue #2081's
   own boundary; making it optional would mean absent-is-fine, which is the permissive reader issue #2067
   rejects. The envelope keeps the version mandatory where it is checked without touching a single
   consumer. **Nothing in this leaf changes what is written to disk** — the envelope is defined and
   tested here and adopted by issue #2096 and issue #2097, which is where the on-disk format actually changes.
4. **Dates are revived, because the contract says `Date`.** `messages[].timestamp` and
   `history[].timestamp` decode from an ISO-8601 string **or** an existing `Date` into a `Date`, and
   an unparseable value is an issue. This is what makes "returns only a fully validated record" true
   rather than nominally true, and it is the direct answer to Symptom 1.
5. **String timestamps are validated as timestamps.** `createdAt`, `updatedAt`, and the other
   `…At` / `at` fields are declared `string` and stay `string`, but must parse as dates — because
   `NodeSessionStore.list` sorts by `new Date(updatedAt).getTime()`
   (`session-store.ts:119-120`, `workspace-session-store.ts:63`), and a non-date string yields `NaN` and an
   unstable order rather than an error.
6. **Unknown keys on a declared object are an issue.** A persisted record is written by this build's
   own code at a known version, so an unrecognised key means the shape drifted — which is what the
   envelope version exists to report. Genuinely open maps are exempt by contract and stay open:
   `IHistoryEntry.data` (declared `T = unknown`), `TUniversalMessageMetadata`, `IMemoryEvent.data`,
   `IBackgroundTask*.metadata`, and `IParameterSchema.properties`.
7. **A limit stated rather than hidden.** `TUniversalValue` and `TUniversalMessageMetadata` both admit
   `Date` as a member. Inside an open map a persisted date is an indistinguishable string, so the
   decoder validates open-map contents as JSON values and does **not** revive dates there. Reviving
   them would mean guessing from string shape, which converts any date-like user string into a `Date`.
   This is a capability of the declared type that persistence cannot carry; it is recorded here rather
   than left for a reader to discover.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — "Affected Scope" above; one package written, four consumer
      packages explicitly out of scope, lane boundary against issue #2080 confirmed.
- [x] Sibling scan 완료 — existing decode/validate siblings read before choosing the shape:
      `decodeChannelFrame` (`agent-transport-protocol/src/channel-frames.ts`, magic + version header,
      throws), `decodeDefinitionFile` (`dag-adapters-local/src/definition-files.ts`),
      `validateSessionReplayLogEntries` (`agent-session/src/session-log-validation.ts`, returns
      `{ ok, issues[] }` with a coded issue vocabulary), and the in-package pure guards
      `isTransportRunOutcome` / `isHandoffCommitted` / `isTurnNotRunError`. The outcome-object shape
      chosen here mirrors `session-log-validation.ts`'s `{ ok, issues }` rather than
      `channel-frames.ts`'s throw, because the caller (issue #2096) must _classify_ the failure, not just
      fail.
- [x] 대안 최소 2개 검토 완료 — four alternatives with pro/con above.
- [x] 결정 근거 문서화 완료 — Decision above states the deciding trade-off (dependency direction vs
      authoring cost; reachability between A and C) and the seven shape decisions with their reasons.
- [x] New-surface placement — **N/A: no new package, app, or presentation/interface surface, and no
      layer or product-family reclassification.** This adds a module directory inside an existing
      package, owned by the package that already declares the type.

## Fallback & Degradation Declaration

None.

This change removes a fallback rather than adding one; the `// allow-fallback:` site it makes
unnecessary (`session-store.ts:93`) is deleted by issue #2096, not here. The decoder itself has no
degraded path: every input either decodes to a complete record or returns a classified failure.

## Solution

A new module directory, `packages/agent-session/src/session-record-codec/`, split to respect the
300-line production file limit:

| Module                              | Owns                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `decode-outcome.ts`                 | `ISessionRecordDecodeIssue`, `TSessionRecordDecodeOutcome`, and the issue-collecting helpers (path building, joining)        |
| `scalars.ts`                        | required/optional string, number, boolean, literal-union, array, open-map, JSON-value, `Date`-revival and ISO-string helpers |
| `message-decoders.ts`               | `TUniversalMessagePart`, `IToolCall`, the four `TUniversalMessage` variants, `IHistoryEntry`                                 |
| `tool-schema-decoders.ts`           | `IParameterSchema`, `IObjectParameterSchema`, `IToolSchema`                                                                  |
| `background-task-members.ts`        | the task literal unions, `IBackgroundTaskError`, `IBackgroundTaskResult` (+ token usage), `IBackgroundTaskSchedule`          |
| `background-task-decoders.ts`       | `IBackgroundTaskState`, driven from key tables for its seventeen optional members                                            |
| `background-task-event-decoders.ts` | the twelve-variant `TBackgroundTaskEvent` union, dispatched by a per-variant lookup rather than a ladder                     |
| `background-group-decoders.ts`      | `IBackgroundJobGroupState`, `IBackgroundJobResultEnvelope`, `TBackgroundJobGroupEvent`                                       |
| `event-decoders.ts`                 | `ISkillActivationEvent`, `IMemoryReference`, `IMemoryEvent`, `IContextReferenceItem`                                         |
| `goal-plan-branch-decoders.ts`      | `IGoalState`, `IGoalProgressEntry`, `IPlanArtifact`, `IPlanStep`, `IActiveBranchPointer`                                     |
| `record-decoder.ts`                 | `INTERACTIVE_SESSION_RECORD_VERSION`, the envelope, and the two decode entry points                                          |
| `record-optional-members.ts`        | every optional member of the record, written out one at a time so each assignment is compiler-checked                        |
| `index.ts`                          | the module barrel                                                                                                            |

Public surface added to `packages/agent-session/src/index.ts`:

```ts
export {
  INTERACTIVE_SESSION_RECORD_VERSION,
  decodeInteractiveSessionRecord,
  decodeVersionedInteractiveSessionRecord,
} from './session-record-codec/index.js';
export type {
  ISessionRecordDecodeIssue,
  IVersionedInteractiveSessionRecord,
  TSessionRecordDecodeOutcome,
} from './session-record-codec/index.js';
```

Outcome contract:

```ts
export interface ISessionRecordDecodeIssue {
  /** Dotted/bracketed location of the failure, e.g. `messages[2].timestamp`. Empty for the root. */
  readonly path: string;
  /** What was required at that path, and what was found. */
  readonly message: string;
}

export type TSessionRecordDecodeOutcome =
  | { readonly status: 'valid'; readonly record: IInteractiveSessionRecord }
  | { readonly status: 'corrupt'; readonly issues: readonly ISessionRecordDecodeIssue[] }
  | { readonly status: 'unsupported'; readonly schemaVersion: number | undefined };
```

A decode collects **every** issue rather than stopping at the first, so one call reports the whole
shape of the damage.

## Affected Files

| File                                                                | Change                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/agent-session/src/session-record-codec/*.ts` (13 files)   | added                                                                      |
| `packages/agent-session/src/index.ts`                               | export block added                                                         |
| `packages/agent-session/src/__tests__/session-record-codec.test.ts` | added                                                                      |
| `packages/agent-session/docs/SPEC.md`                               | Scope, Boundaries, Type Ownership, Public API Surface, and a codec section |
| `.agents/tasks/TRANS-005-…​.md`                                     | status/plan                                                                |

No file outside `packages/agent-session/` is written by this leaf. In particular
`packages/agent-interface-transport/` is byte-identical to the integration branch, and
`.agents/harness.config.json` is untouched — both were written under the superseded placement and
both were reverted with it.

## Completion Criteria

- [x] TC-01: `decodeInteractiveSessionRecord(value)` accepts `unknown` and, for every non-record input
      in the malformed corpus (`null`, `undefined`, `42`, `'{}'`, `[]`, `{}`), returns
      `status: 'corrupt'` with at least one issue — never throws.
- [x] TC-02: A complete record containing every optional field decodes to `status: 'valid'`, and the
      returned `record` deep-equals the input except that `messages[].timestamp` and
      `history[].timestamp` are `Date` instances.
- [x] TC-03: For each of the 15 nested contract families listed in "Affected Scope", a record whose
      only defect is inside that family returns `status: 'corrupt'` and reports an issue whose `path`
      names the offending field (e.g. `backgroundTasks[0].depth`, `plan.steps[1].status`).
- [x] TC-04: An ISO-8601 string, and an existing `Date`, both decode to an equal `Date` at
      `messages[0].timestamp`; `'not-a-date'`, `''`, `0`, and `null` each produce an issue at that path.
- [x] TC-05: A record whose `updatedAt` is a non-empty string that `Date.parse` rejects returns
      `status: 'corrupt'` with an issue at `updatedAt`.
- [x] TC-06: An unknown key on a declared object (root, a message, a background task) produces an
      issue naming that key; an unknown key inside `history[].data`, `messages[].metadata`,
      `memoryEvents[].data`, and `toolSchemas[].parameters.properties` produces none.
- [x] TC-07: `decodeVersionedInteractiveSessionRecord({ schemaVersion: N, record })` returns
      `status: 'unsupported'` with `schemaVersion: N` for any `N !== INTERACTIVE_SESSION_RECORD_VERSION`,
      and for a missing/non-numeric `schemaVersion` returns `status: 'unsupported'` with
      `schemaVersion: undefined` — in every case **without** reporting nested field issues.
- [x] TC-08: A record with two independent defects returns both issues in one outcome (the decoder
      does not stop at the first).
- [x] TC-09: A key-parity test fails if a key of `IInteractiveSessionRecord` (and of each directly
      nested interface) has no corresponding branch in its decoder — so a contract field added later
      without a decoder branch breaks the build rather than passing silently.
- [x] TC-10: `pnpm --filter @robota-sdk/agent-session build` succeeds and the package's declared
      dependencies are unchanged (`@robota-sdk/agent-core` and `@robota-sdk/agent-interface-transport`),
      verified by `pnpm harness:scan:deps`.
- [x] TC-11: Every new production file is ≤ 300 lines, verified by `pnpm harness:scan:file-size`
      reporting no new baseline entry.
- [x] TC-12: `packages/agent-session/docs/SPEC.md` documents the new public exports under Public API
      Surface and the codec's outcome vocabulary, and `pnpm harness:scan:spec-public-surface` passes.
      `packages/agent-interface-transport/` is byte-identical to the integration branch, and
      `scan-interface-runtime` passes.

## Test Plan

| TC-ID | Test Type         | Tool / Approach                                                                                     | Notes                                                                |
| ----- | ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| TC-01 | Unit (corpus)     | vitest — table-driven over a shared malformed-input corpus                                          | Assert no throw via `expect(() => …).not.toThrow()` around each case |
| TC-02 | Unit (round-trip) | vitest — a maximal fixture record built in the test, `JSON.parse(JSON.stringify(fixture))` as input | The stringify step is what reproduces the real persistence path      |
| TC-03 | Unit (table)      | vitest — one mutation per nested family, asserting the reported `path`                              | 15 rows; the fixture from TC-02 is the unmutated base                |
| TC-04 | Unit              | vitest — parameterised over accepted and rejected timestamp inputs                                  |                                                                      |
| TC-05 | Unit              | vitest                                                                                              |                                                                      |
| TC-06 | Unit              | vitest — paired assertions (strict site rejects / open site accepts)                                |                                                                      |
| TC-07 | Unit              | vitest — versions `0`, `2`, `1.5`, `'1'`, absent                                                    | Asserts issues array is absent, so `unsupported` is not `corrupt`    |
| TC-08 | Unit              | vitest                                                                                              |                                                                      |
| TC-09 | Unit (parity)     | vitest — a `satisfies Record<keyof IInteractiveSessionRecord, true>` map beside the runtime key set | Compile-time exhaustiveness plus a runtime set comparison            |
| TC-10 | Build / scan      | `pnpm --filter @robota-sdk/agent-session build` + `pnpm harness:scan:deps`                          |                                                                      |
| TC-11 | Scan              | `pnpm harness:scan:file-size`                                                                       |                                                                      |
| TC-12 | Scan + review     | `pnpm harness:scan:spec-public-surface`                                                             |                                                                      |

Property testing (issue #2081, "malformed-record corpus and property tests") is covered by TC-01 and
TC-03 running as table-driven mutations over one maximal fixture: every field of every nested contract
is mutated in turn from a valid base, which is the property "no single-field mutation of a valid
record decodes as valid".

## User Execution Test Scenarios

**Not applicable is NOT claimed here.** This leaf delivers no CLI, TUI or browser behaviour — no
product surface routes through the decoder until issue #2096 — but `backlog-execution.md` names
"public SDK/example usage for SDK-only features" as a product surface in its own right, and the codec
is exported from a published package. So the scenario below drives the real public surface, and the
library-seam "N/A" dodge the Capability Reachability rule forbids is not taken.

The still-pending end-to-end verification is named rather than implied: the behaviour a USER
experiences — a corrupt session file reported instead of silently replaced by a field-stripped replay
— is not reachable until issue #2096 routes `NodeSessionStore.load` through this decoder, and that
issue's own gate owns it. This slice's scenario proves the decoder itself, from outside the package,
against its built artifact.

### UES-01 — the published decoder decides all three outcomes on the real build

- **Agent-executability:** `agent-executable`.
- **Prerequisite state:** the package is built, so the scenario runs against `dist/` — the artifact a
  consumer actually installs — and not against source:

  ```bash
  pnpm --filter @robota-sdk/agent-session build
  ```

- **Exact command:**

  ```bash
  node --input-type=module -e "
  import { decodeInteractiveSessionRecord, decodeVersionedInteractiveSessionRecord, INTERACTIVE_SESSION_RECORD_VERSION } from './packages/agent-session/dist/node/index.js';
  const record = { id: 's1', cwd: '/w', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: '2026-08-01T00:00:01.000Z', state: 'complete' }] };
  const ok = decodeInteractiveSessionRecord(JSON.parse(JSON.stringify(record)));
  console.log('1', ok.status, ok.status === 'valid' && ok.record.messages[0].timestamp instanceof Date);
  const bad = decodeInteractiveSessionRecord({ ...record, messages: [{ ...record.messages[0], timestamp: 'not-a-date' }] });
  console.log('2', bad.status, bad.status === 'corrupt' ? bad.issues.map(i => i.path).join(',') : '');
  const old = decodeVersionedInteractiveSessionRecord({ schemaVersion: 99, record });
  console.log('3', old.status, old.schemaVersion, 'issues' in old);
  const cur = decodeVersionedInteractiveSessionRecord({ schemaVersion: INTERACTIVE_SESSION_RECORD_VERSION, record });
  console.log('4', cur.status);
  "
  ```

  The record is round-tripped through `JSON.parse(JSON.stringify(...))` on line 1 for the same reason
  the unit fixture is: that is what persistence actually hands a reader, with the `Date` already
  flattened to a string.

- **Expected observable result** — exit code 0 and exactly these four lines:

  ```
  1 valid true
  2 corrupt messages[0].timestamp
  3 unsupported 99 false
  4 valid
  ```

  Line 1 is the revival (a `Date` instance came back out of a string). Line 2 is a located failure,
  not a boolean. Line 3 is the version gate reporting the version it saw AND carrying no nested field
  issues, which is what makes `unsupported` distinguishable from `corrupt` by a caller. Line 4 is the
  current version decoding through the envelope.

- **Cleanup:** none — the scenario writes nothing and starts no process.
- **Evidence field:** recorded in the Evidence Log under `[DONE-GATE-STAGE-2]`.

## Tasks

- [x] TRANS-005 — done — `.agents/tasks/completed/TRANS-005-versioned-total-decoder-for-the-persisted-session-record.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready

- Frontmatter: opens with `---`; `status: draft`; `type: DATA` (member of the 11-prefix list);
  `tags: [session, persistence, codec, contract, decoder]` present.
- Problem — concrete symptom: three symptoms, each cited to a file and line
  (`session-store.ts` bare cast; `execution-workspace-detail.ts:19`
  `entry.timestamp.toISOString()` against a contract-declared `Date` that persistence delivers as a
  string; the replay fallback reading corruption as absence). Line numbers and two class names in
  this entry were written before ARCH-100 (PR #2176) renamed `SessionStore` to `NodeSessionStore` and
  moved `session-persistence.ts` to `workspace-session-store.ts`; the Problem section above is
  repointed at the current code, and this entry is left as written because an evidence record
  describes the run that produced it.
- Problem — reproduction condition: resume a persisted session and reach a consumer that calls a
  `Date` method on `messages[]`/`history[]` `timestamp`. Verified by reading the whole load path —
  `SessionStore.load` → `SessionPersistence.load` → consumer — and confirming no revival step exists
  (`git grep "new Date(" ` over those files returns only `updatedAt` re-parses for sorting).
- Problem — no "TBD"/"TODO"/vague text: `grep -nE "TBD|TODO|works correctly|no errors|displays correctly"` returns nothing.
- Prior Art Research: substantiated with three product-documentation citations —
  <https://zod.dev/error-formatting> (issue `path` array + three renderings),
  <https://docs.langchain.com/oss/python/langgraph/checkpointers> (`SerializerProtocol.dumps_typed`
  returns a type identifier with the blob; `pickle_fallback` is opt-in),
  <https://protobuf.dev/programming-guides/proto3/#updating> (schema-update rules; unknown fields are
  lost when serializing to JSON). Each is stated as a constraint that applies here, and the absence of
  a comparable TypeScript-interface-only reference is stated explicitly rather than left blank. All
  three feed Alternatives (B's diagnostics pro, the JSON-format constraint behind the strict reading)
  and the Decision's points 1, 2 and 6. `node scripts/harness/scan-spec-research.mjs` — passed.
- Architecture Review Checklist: all 4 items `[x]`. Sibling scan is `[x]` with named evidence — four
  existing decode/validate siblings read (`channel-frames.ts`, `definition-files.ts`,
  `session-log-validation.ts`, the in-package pure guards) and the outcome shape justified against
  them. New-surface placement recorded as `N/A` with reason (no new package/app/surface; a module
  directory inside the package that already declares the type).
- Alternatives Considered: 4 entries (hand-written decoder / Zod / place in `agent-session` /
  code-generation), each with explicit pro and con. Decision names the deciding trade-off
  (dependency direction vs authoring cost; reachability between A and C — three packages consume the
  type without depending on `agent-session`).
- Completion Criteria: 12 items, every one `TC-N` prefixed (`grep -c '^- \[ \] TC-'` = 12). Each is a
  command form or an observable-behaviour form; none uses banned vague language.
- Test Plan: present; 12 rows (`grep -cE '^\| TC-[0-9]+ \|'` = 12), matching the 12 criteria
  one-to-one. Every row has a non-empty Test Type and Tool/Approach; no row uses "manual", so the
  manual-justification requirement does not apply.
- Structure: `## Tasks` present; `## Evidence Log` present and empty before this entry (first
  GATE-WRITE run); no `## Status` or `## Classification` section in the body.
- `node scripts/harness/check-spec-doc-frontmatter.mjs` — passed (286 spec documents examined; the
  four reported warnings are pre-existing duplicate IDs in other documents, none of them TRANS-005).

**Recorded by:** this session, judged against the gate catalogue's GATE-WRITE criteria directly. The
`backlog-gate-guard` subagent was not dispatched, because this session is operating under a
user instruction not to invoke the Agent tool. Every criterion above was checked mechanically where a
command exists and by reading the document where one does not.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

**Prior gate:** GATE-WRITE shows PASS above; input status was `review-ready` in
`.agents/spec-docs/backlog/`, as the prior-gate map requires.

**Form of approval: a standing delegation, not a per-item sign-off.** Recorded here in the three parts
`backlog-execution.md` § "Standing authorization" requires, and deliberately not claimed as anything
stronger than it is.

**(1) The delegation, verbatim.** The owner's session-opening instruction to the orchestrating session
(`robota-a6`):

> 지금부터 깃헙 이슈에 등록된 것들을 처리할 것인데, 이슈들은 순서를 잘 맞춰서 처리해야함. 그렇기 때문에
> 너에게 오케스트레이션 권한을 줄테니 다른 세션들과 의사소통 하면서 이슈들을 나눠서 처리해줘.

The orchestrating session then put the GATE-APPROVAL question to the owner explicitly, naming this
rule and stating that a peer session cannot supply the sign-off. The owner **selected** the offered
option `위임 선언 — 이슈 처리 전권`, whose text reads:

> 「근거가 타당하면 스스로 승인하고 진행하라」는 취지의 표준 위임을 지금 선언해 주시면, 각 spec의
> Evidence Log에 그 문장을 그대로 인용하고 + 근거 조건 충족을 입증하고 + 해당 항목이 위임 범위 안임을
> 보여서 GATE-APPROVAL을 통과시킵니다.

**Recorded precisely: the owner SELECTED that option; they did not type a fresh sentence.** The
prior instance of the same delegation from the same owner is on record at
`.agents/tasks/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md`
(2026-08-15): "내가 승인하는게 아니라 근거가 타당하면 너가 알아서 승인하고 넘어가야지".

**Provenance, stated rather than smoothed over:** this delegation reached this session **relayed by
the orchestrating session**, not typed into this conversation. A peer session cannot grant approval on
the owner's behalf, and this entry does not claim it did — it records that the peer put the question
to the owner and reports what the owner chose. The relay is surfaced to the owner in this session's
own transcript, so the record can be corrected by the one person able to correct it.

**(2) The evidence condition is satisfied for THIS item.** The delegation is conditional on 근거 —
the reasoning being sound — not unconditional:

- The problem is verified against the code, not asserted: every symptom cites a file and line, and the
  central claim (no date revival exists on the load path) was established by reading the whole path
  and by `git grep "new Date("` over those three files, which returns only `updatedAt` sort re-parses.
- The design was checked for reachability before being chosen: alternative C was rejected on the
  measured fact that `agent-transport-protocol`, `agent-session-analytics` and `agent-transport-tui`
  reference `IInteractiveSessionRecord` without depending on `agent-session`.
- The chosen placement was checked against the mechanical constraint that would have invalidated it:
  the `deps` scan permits `agent-interface-*` no internal dependency beyond `agent-core`, which is why
  alternative B is unavailable and why A adds no dependency edge.
- The known cost of the choice is answered mechanically rather than by intention: A's
  hand-maintenance con is bound by TC-09, a key-parity test that fails the build when a contract field
  gains no decoder branch.
- Four alternatives were considered with explicit pro/con, and three product-documentation sources
  constrain the decision.

**(3) The item sits inside the delegated class.** issue #2081 is an internal versioned decoder for an
existing type, with a tracker (issue #2067), a stated acceptance list, and a scope boundary that forbids
touching any consumer. Against the four exclusions a standing authorization never covers:

- _Product direction / user-facing scope_ — none. No user-visible behaviour changes in this leaf; the
  decoder has no caller until issue #2096.
- _A published or externally visible contract_ — **checked, and this is the one worth stating.** The
  new exports are additive to a prerelease package. Critically, this leaf **changes nothing that is
  written to disk**: `schemaVersion` is deliberately kept out of `IInteractiveSessionRecord`
  (Decision, point 3), the envelope is defined and tested but adopted by no producer here, and no
  store, artifact, handoff, or replay path is migrated. The on-disk format actually changes in issue #2096;
  that item is flagged to the orchestrating session as possibly leaving the delegated class, and this
  entry does not pre-approve it.
- _Business / legal / strategic judgement_ — none.
- _A practice this repository has not used before_ — none; alternative D was rejected partly on
  exactly that ground, and the chosen shape mirrors existing in-repo siblings
  (`session-log-validation.ts`'s `{ ok, issues }`, the package's own pure type guards).
- _Repository-wide policy files_ — untouched. No lint config, CI workflow, git hook, or workspace
  topology file is in "Affected Files".

**Independent architecture validation (conditional):** N/A — the spec introduces no new package, app,
or presentation/interface surface, and reclassifies no layer or product-family boundary. It adds a
module directory to the package that already declares the type.

**No Architecture Review or frontmatter `type`/`tags` change is made after this entry.**

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-23

**Status upgrade:** approved → in-progress

**Prior gate:** GATE-APPROVAL shows PASS above; input status was `approved` in
`.agents/spec-docs/todo/`.

- Task file exists:
  `.agents/tasks/TRANS-005-versioned-total-decoder-for-the-persisted-session-record.md`,
  allocated by `pnpm harness:task:allocate TRANS "…" --issue 2081`. The `--dry-run` was run first and
  printed `TRANS-005` (1455 claimed ids examined — 877 from records, 1441 from citations, 87 from
  issue titles), matching the orchestrating session's independent ledger read before the record was
  written.
- Task file path is recorded in this document's `## Tasks` section.
- Task correspondence: the task file's `## Plan` has one entry per TC-N, TC-01 through TC-12 — twelve
  entries against twelve completion criteria, each naming the module(s) that satisfy it.
- Test Plan section: the task file carries `## Test Plan` at ~1,100 characters, naming the test file,
  the runner command, the fixture strategy, and the five gate commands — well above the 50-character
  floor the `test-plans` harness scan requires.

**Evidence:** `.agents/tasks/TRANS-005-versioned-total-decoder-for-the-persisted-session-record.md`
— 12 plan tasks (TC-01…TC-12), `## Test Plan` present, `status: in-progress`,
`area: packages/agent-interface-transport`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-23

Scenario UES-01 is fully written: agent-executability decision (`agent-executable`), prerequisite
build step, the exact command, the expected observable stated as four literal lines with what each
one proves, cleanup, and the evidence field. Nothing is left unwritten, so the by-exception path does
not apply.

Executability was established BEFORE the scenario was written, by running the command — not asserted
after. The Capability Reachability rule is answered rather than dodged: the surface used is public
SDK usage of a published package, which `backlog-execution.md` names as a product surface, and the
still-pending end-to-end verification (a user seeing a corrupt session reported instead of silently
replaced) is named as belonging to issue #2096's gate rather than claimed here.

### [GATE-VERIFY] — ✅ PASS | 2026-08-23

**Status upgrade:** in-progress → verifying (no folder change; `verifying` maps to `active/`)

**Prior gate:** GATE-IMPLEMENT shows PASS above; input status was `in-progress` in `active/`.

- All tasks in the task file are `[x]`: 12 of 12 (`grep -c '^- \[x\] TC-'` = 12,
  `grep -c '^- \[ \]'` = 0). None blocked or pending.
- Build passes: `pnpm --filter @robota-sdk/agent-interface-transport build` — clean, 12 files emitted.
  `pnpm harness:verify` exited 0 over the affected scope (build, test, lint, typecheck for the owning
  package; typecheck for all 21 dependents).
- Tests pass: `pnpm --filter @robota-sdk/agent-interface-transport test` — **77 passed**.
- Scans: `check-dependency-direction` (no violations; declared dependencies still `agent-core` only),
  `scan-file-size`, `check-spec-public-surface`, `scan-spec-user-execution-section`,
  `scan-doc-folder-status-agreement`, `check-spec-doc-frontmatter`, `scan-spec-research`,
  `scan-test-plan` — all pass. `eslint src/session-record-codec` — 0 errors.

**The tests were checked, not merely run.** Two mutation rounds, because a green suite proves nothing
about whether it would go red:

1. Breaking date revival and unknown-key rejection in `scalars.ts` turned **7 tests red**; restoring
   returned 73 green.
2. Collapsing `MESSAGE_KEYS_BY_ROLE` into one union of all four variants' keys turned **exactly the 4
   new variant-key tests red**; restoring returned 77 green.

The second round exists because of a gap found by review rather than by the suite: the original
unknown-key coverage used an invented key (`surprise`), which a union implementation rejects
identically — so it constrained "unknown keys are rejected" and not "the key set is per-variant",
while `message-decoders.ts`'s own header claimed the latter. TC-06 now covers four members that only
another variant declares.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-23

Scenario UES-01 executed against the built artifact (`dist/node/index.js`), not against source.

Command run: the `node --input-type=module -e …` block recorded verbatim in UES-01, after
`pnpm --filter @robota-sdk/agent-interface-transport build`.

Observed output — exit code 0, and identical to the expected result written before the run:

```
1 valid true
2 corrupt messages[0].timestamp
3 unsupported 99 false
4 valid
```

Line 1 proves revival across the real package boundary: a record whose `Date` was flattened by
`JSON.stringify` came back carrying a `Date` instance. Line 2 proves the failure is LOCATED rather
than boolean. Line 3 proves the version gate reports the version it saw and carries no nested field
issues, which is what lets a caller tell `unsupported` from `corrupt`. Line 4 proves the current
version decodes through the envelope.

The expected result was not rewritten after observation; it was authored from a pre-implementation
executability run and matched on the gate run.

**Durable artifacts backing this evidence:**
`packages/agent-interface-transport/src/session-record-codec/` (12 modules) and
`packages/agent-interface-transport/src/__tests__/session-record-codec.test.ts` (77 tests).

---

### [AMENDMENT — placement] — 🔴 recorded | 2026-08-23

**What changed:** the Architecture Review's Decision. It chose alternative A (codec in
`agent-interface-transport`); it now chooses alternative C's PLACEMENT with alternative A's SHAPE
(codec in `agent-session`, hand-written). The full amendment, the guard that refuted the original,
and the reasoning error behind it are recorded in-place in § Decision rather than only here.

**Why it is recorded as an amendment and not applied quietly:** GATE-APPROVAL had already been
recorded against the superseded text, and the gate catalogue's own criterion is "No Architecture
Review or frontmatter type/tags modified after approval". Editing the Review therefore invalidates
that approval. The entries below re-run every gate whose evidence was collected against the
superseded placement.

**Superseded by this amendment — do not read the following as current:**

- `[GATE-APPROVAL] — ✅ PASS | 2026-08-23` (the first one): approved a Decision that no longer exists.
- `[GATE-VERIFY] — ✅ PASS | 2026-08-23` (the first one): its build, test and scan evidence was
  collected against `packages/agent-interface-transport`, which this leaf no longer writes.
- `[DONE-GATE-STAGE-1]` and `[DONE-GATE-STAGE-2]` (the first ones): UES-01 named the
  `agent-interface-transport` build and dist path.

Nothing in those entries was false when written. They are superseded because the thing they measured
moved, which is exactly the case where carrying a green forward is the defect.

### [GATE-APPROVAL] — ✅ PASS (re-recorded against the amended Decision) | 2026-08-23

**Status:** verifying (the document had already advanced; this re-establishes the approval the
amendment invalidated, it does not re-run the status ladder).

**(1) The delegation, verbatim** — unchanged, and reproduced rather than referenced so this entry
stands on its own. The owner's session-opening instruction to the orchestrating session:

> 지금부터 깃헙 이슈에 등록된 것들을 처리할 것인데, 이슈들은 순서를 잘 맞춰서 처리해야함. 그렇기 때문에
> 너에게 오케스트레이션 권한을 줄테니 다른 세션들과 의사소통 하면서 이슈들을 나눠서 처리해줘.

and, on the GATE-APPROVAL question put to them explicitly, the owner SELECTED the option
`위임 선언 — 이슈 처리 전권`:

> 「근거가 타당하면 스스로 승인하고 진행하라」는 취지의 표준 위임을 지금 선언해 주시면, 각 spec의
> Evidence Log에 그 문장을 그대로 인용하고 + 근거 조건 충족을 입증하고 + 해당 항목이 위임 범위 안임을
> 보여서 GATE-APPROVAL을 통과시킵니다.

**Provenance, unchanged and still stated:** this reached the session RELAYED by the orchestrating
session, not typed into its conversation. The owner selected an option rather than composing a
sentence. A peer session cannot grant approval on the owner's behalf and this entry does not claim
it did.

**(2) The evidence condition, RE-TESTED against the amended Decision** — this is the half that had to
be re-established, because the amendment changed what is being approved:

- The placement is now the one the repository's own guard requires, rather than one it refuses:
  `scan-interface-runtime` passes (`violations=0 scanned=27`), where the superseded placement failed
  it at 9 mechanisms against a frozen 5.
- The reachability claim that decided the original choice was re-tested rather than re-asserted, and
  it did not survive: it is true of the record TYPE and false of the DECODER, whose every actual and
  planned consumer (issue #2096, issue #2097, issue #2098) is in `agent-session` or in
  `agent-framework`, which depends on it.
- The correction was made in the direction the rule points, not the cheap one: the frozen allowance
  in `scripts/harness/interface-entry-baseline.json` was NOT raised, and
  `.agents/harness.config.json` was reverted to the integration branch — the amended placement needs
  no exemption of any kind.
- Every other decision the original approval rested on is unchanged and re-verified below.

**(3) The item still sits inside the delegated class,** and the amendment narrows rather than widens
it: the change now writes ONE package, adds no dependency edge, publishes no new contract, alters no
shared configuration file, and leaves `packages/agent-interface-transport/` byte-identical to the
integration branch. The four exclusions are untouched — no product direction, no externally visible
contract (nothing this leaf ships changes a byte on disk), no business/legal judgement, no
repository-wide policy file.

### [GATE-VERIFY] — ✅ PASS (re-recorded after the move) | 2026-08-23

**Prior gate:** GATE-IMPLEMENT shows PASS above; GATE-APPROVAL is re-recorded immediately above.

- Task file: 12 of 12 `[x]`, none blocked or pending; `area:` corrected to `packages/agent-session`.
- Build: `pnpm --filter @robota-sdk/agent-session build` — `Build complete`, dist emitted.
- Tests: `pnpm --filter @robota-sdk/agent-session test` — **44 files, 308 tests, all passing**. That
  is the package's WHOLE suite, not just the new file: the move put the codec into a package with
  existing tests, so the number that matters is that none of them regressed.
- Scans: `node scripts/harness/run-all-scans.mjs` — **138 passed, 1 skipped, 0 failed**. Named
  individually because each was red at some point during this work and each is now green for a
  reason rather than by luck: `interface-runtime` (violations=0 — the guard that forced the move),
  `sdk-public-surface`, `orphan-exports`, `backlog-placement`, `resolving-claims`,
  `reference-kind-qualified`, `file-size`, `deps` (no violations), `spec-public-surface`,
  `spec-user-execution-section`, `doc-folder-status`.
- `packages/agent-interface-transport/` is byte-identical to `origin/develop`
  (`git diff origin/develop -- packages/agent-interface-transport/` is empty), and
  `.agents/harness.config.json` is likewise reverted.

**The tests were checked, not merely run** — two mutation rounds, unchanged by the move and re-run
after it:

1. Breaking date revival and unknown-key rejection in `scalars.ts` turned **7 tests red**.
2. Collapsing `MESSAGE_KEYS_BY_ROLE` into one union of all four variants' keys turned **exactly the 4
   variant-key tests red**.

Both restored to green. The second round exists because review found a gap the suite could not:
the original unknown-key coverage used an invented key, which a union implementation rejects
identically — so it constrained "unknown keys are rejected" and not "the key set is per-variant",
while the module's own header claimed the latter.

### [DONE-GATE-STAGE-1] — ✅ PASS (re-recorded after the move) | 2026-08-23

UES-01 is fully written and re-pointed at the new owner package: prerequisite
`pnpm --filter @robota-sdk/agent-session build`, and the import under test is
`./packages/agent-session/dist/node/index.js`. Agent-executability decision, exact command, expected
observable as four literal lines with what each proves, cleanup, and evidence field are all present.
Executability was re-established by running it after the move, before this entry was written.

### [DONE-GATE-STAGE-2] — ✅ PASS (re-recorded after the move) | 2026-08-23

UES-01 executed against `packages/agent-session/dist/node/index.js` — the built artifact of the
package that now owns the codec, not source, and not the old package.

Observed — exit code 0, identical to the expected result authored before the run:

```
1 valid true
2 corrupt messages[0].timestamp
3 unsupported 99 false
4 valid
```

The expected result was not rewritten after observation. It was authored from a pre-implementation
executability run, matched on the first gate run against `agent-interface-transport`, and matched
again unchanged against `agent-session` — which is itself evidence that the move preserved behaviour
rather than merely preserving the tests.

**Durable artifacts:** `packages/agent-session/src/session-record-codec/` (13 modules) and
`packages/agent-session/src/__tests__/session-record-codec.test.ts` (77 tests).

### [GATE-COMPLETE] — ✅ PASS | 2026-08-23

**Status upgrade:** verifying → done

Every criterion below was verified against the CURRENT placement (`packages/agent-session`). Test
references name the file and the `describe` that owns each criterion:
`packages/agent-session/src/__tests__/session-record-codec.test.ts`.

- **[GATE-COMPLETE: TC-01]** Command: `pnpm --filter @robota-sdk/agent-session test`. Result: the
  nine-case corpus (`null`, `undefined`, `42`, `'{}'`, `[]`, `{}`, `true`, a record missing every
  required field, a record with no `messages`) each returns `corrupt` with ≥1 issue, and each case
  asserts `not.toThrow()` around the call. Test: `> decodeInteractiveSessionRecord — TC-01 total over
unknown input > reports %s as corrupt without throwing`. Exit code 0.
- **[GATE-COMPLETE: TC-02]** A maximal record with every optional field populated, round-tripped
  through `JSON.parse(JSON.stringify(...))`, decodes to `valid` and `toEqual`s the original — with
  `messages[].timestamp` and `history[].timestamp` back as `Date` instances. Test: `> TC-02 a maximal
record round-trips > decodes a persisted maximal record to valid` and `> revives the
contract-declared Date members as Date instances`.
- **[GATE-COMPLETE: TC-03]** 26 single-field mutations, one per nested contract family, each
  asserting `corrupt` AND the exact reported `path` (`backgroundTasks[0].depth`,
  `plan.steps[1].status`, `toolSchemas[0].parameters.properties.path.type`, …). Test: `> TC-03 every
nested family reports its path > %s: a defect at %s is reported at that path`, plus `> reports a
missing required nested field at its own path`.
- **[GATE-COMPLETE: TC-04]** ISO-8601 string and live `Date` both decode to an equal `Date`;
  `'not-a-date'`, `''`, `0`, `null` and `{}` each produce an issue at `messages[0].timestamp`. Test:
  `> TC-04 date revival` (three cases plus a five-case table).
- **[GATE-COMPLETE: TC-05]** `updatedAt: 'last thursday'` and `createdAt: ''` are both reported at
  their own path; a valid string timestamp stays a `string` in the decoded record. Test: `> TC-05
string timestamps must parse`.
- **[GATE-COMPLETE: TC-06]** Unknown keys rejected on the root, a message, a background task and the
  goal; permitted inside `history[].data`, message `metadata`, `memoryEvents[].data`, task
  `metadata`, and a schema's `properties`. PLUS four members that only ANOTHER variant declares
  (`toolCallId`/`toolCalls` on a user message, `name`/`toolCallId` on an assistant message), which is
  what distinguishes per-variant key sets from one union. Test: `> TC-06 unknown keys`.
- **[GATE-COMPLETE: TC-07]** Versions `0`, `2`, `1.5`, `-1` report `unsupported` carrying that
  version; `'1'`, absent and `null` report `unsupported` with `schemaVersion: undefined`; an
  unsupported version carries NO `issues` key; a non-envelope is `corrupt`, not `unsupported`; a
  current-version envelope wrapping a corrupt record reports `corrupt` at `record.id`. Test: `>
decodeVersionedInteractiveSessionRecord — TC-07 version gate`.
- **[GATE-COMPLETE: TC-08]** Two independent defects (`id` and `cwd`) are both reported from one
  call, and every issue carries a non-empty message. Test: `> TC-08 issues accumulate`.
- **[GATE-COMPLETE: TC-09]** `INTERACTIVE_SESSION_RECORD_KEYS` is compared against an object literal
  declared `satisfies Record<keyof IInteractiveSessionRecord, true>` — so a member added to the
  contract without a decoder branch fails to COMPILE, and a runtime set comparison catches the
  reverse. Test: `> TC-09 key parity between the contract and the decoder`.
- **[GATE-COMPLETE: TC-10]** Command: `pnpm --filter @robota-sdk/agent-session build` → `Build
complete`, dist emitted, exit 0. Command: `node scripts/harness/check-dependency-direction.mjs` →
  `✅ No dependency direction violations found.` The package's declared dependencies are unchanged —
  the codec imports only `@robota-sdk/agent-interface-transport` and `@robota-sdk/agent-core`, both
  already declared, so no `package.json` was edited.
- **[GATE-COMPLETE: TC-11]** Command: `node scripts/harness/scan-file-size.mjs` → `harness file-size
scan passed (80 baselined burn-down entries)`. All 13 new production modules are ≤300 lines and
  none was added to the baseline. Recorded because it drove a real design decision: the 300-line cap
  is why the codec is a module directory rather than one file.
- **[GATE-COMPLETE: TC-12]** Command: `node scripts/harness/check-spec-public-surface.mjs` → `spec
public-surface scan passed`. `packages/agent-session/docs/SPEC.md` gained the Scope and Boundaries
  statements of codec ownership, three Type Ownership rows, four Public API Surface rows, and § "The
  Persisted Session Record Is Decoded, Never Cast (TRANS-005)". Command:
  `node scripts/harness/scan-interface-runtime.mjs` → `violations=0 scanned=27`. Command:
  `git diff origin/develop -- packages/agent-interface-transport/` → empty.

**Test Plan coverage — every TC-N row addressed, none silently skipped:**

TC-01 through TC-09 are automated in
`packages/agent-session/src/__tests__/session-record-codec.test.ts` at the `describe` names quoted
above. TC-10, TC-11 and TC-12 are scan/build rows rather than unit tests, and each names the exact
command and its observed output above — no automated unit test is written for them because the
harness scan IS the automated check, and duplicating it in vitest would assert the scan's result
rather than the property.

**Summary.** 12 of 12 completion criteria met and evidenced. 77 codec tests green inside a package
suite of 308, all 44 files passing. 138 harness scans pass, 0 fail. The user-execution scenario ran
against the built artifact and matched an expectation authored before implementation. The one
architectural decision that was wrong — the placement — was caught by the repository's own guard,
amended in the open, re-approved against the amended text, and re-verified end to end rather than
carried forward on a stale green.
