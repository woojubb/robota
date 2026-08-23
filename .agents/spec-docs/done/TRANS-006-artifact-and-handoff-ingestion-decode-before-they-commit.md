---
status: done
type: DATA
tags: [session, persistence, codec, handoff, artifact]
---

# TRANS-006: artifact import and handoff commit accept a record nobody decoded

Design for Task
[`.agents/tasks/completed/TRANS-006-artifact-and-handoff-ingestion-decode-before-they-commit.md`](../../tasks/completed/TRANS-006-artifact-and-handoff-ingestion-decode-before-they-commit.md),
the execution leaf [issue #2097](https://github.com/woojubb/robota/issues/2097) under tracker
[issue #2067](https://github.com/woojubb/robota/issues/2067). Depends on
[issue #2081](https://github.com/woojubb/robota/issues/2081) (TRANS-005), which shipped the decoder
this leaf routes through.

## Problem

Two ingresses accept a complete session record from outside this process and commit it without
decoding it. Both check something real first, and in both cases what they check is not what they
then assume.

**Symptom 1 — the artifact importer validates an envelope and a single field.**
`deserializeSessionArtifact` (`packages/agent-session/src/session-artifact.ts:62-83`) rejects a
missing or unsupported `schemaVersion`, then checks that `record` is a non-array object whose `id`
is a string, and returns it as an `IInteractiveSessionRecord`. Every other member is unchecked:
`messages`, `history`, `toolSchemas`, the background task and job-group arrays, `goal`, `plan`,
`activeBranch`. Its own comment states the intent — _"Reject a degenerate/crafted payload
(`record: []` / `{}` / no id) rather than importing an empty record"_ — and the check delivers
exactly that and no more.

Reproduction condition: import any artifact whose `record.id` is a string. `{"schemaVersion":1,
"record":{"id":"x","messages":"not-an-array"}}` deserializes successfully today and is handed to
`store.save(...)` by
`packages/agent-framework/src/interactive/__tests__/session-artifact-resume.test.ts:45`.

**Symptom 2 — the handoff destination proves the bytes and then assumes the shape.**
`HandoffDestination.receiveChunk`
(`packages/agent-framework/src/handoff/handoff-destination.ts:98-111`) verifies the payload against
the manifest's digest and byte length, and on success does
`this.record = JSON.parse(result.serialized ?? '') as IInteractiveSessionRecord` and moves to
`staged`. The file's own comment one paragraph above states the discipline it then breaks:
_"Nothing is parsed before the integrity check passes."_ Nothing is DECODED after it passes either.

Integrity is not validity. A digest proves the bytes that arrived are the bytes that were sent; it
says nothing about whether those bytes are a session record. A source running a different build, a
partially written record, or a crafted payload all produce an intact transfer of an invalid record —
and `commit()` (`:197-198`) then returns it as the session this machine will resume.

**What both share.** Since issue #2081 there is exactly one component that answers "is this a valid
record?", and neither ingress calls it. The store and the JSONL replay path have the same defect and
are explicitly NOT this leaf's (issue #2096 and issue #2098).

## Prior Art Research

**Question.** When a system receives a payload it has verified for transport integrity, is schema
validity a separate check with a separate outcome — or does integrity standing in for validity count
as an accepted design?

**Google Cloud Storage Transfer Service — integrity has its own named failure, and is documented as
insufficient on its own.** The
[data-integrity documentation](https://docs.cloud.google.com/storage-transfer/docs/data-integrity)
states that on a checksum mismatch "the task fails with a `DATA_LOSS` error" — a specific error
class rather than a generic failure. The same page then recommends performing "additional data
integrity checks" after a transfer completes, to verify correct file versions, complete file sets
and metadata accuracy, explicitly acknowledging that its own validation "may not be sufficient for
all use cases". **Constraint that applies to Robota:** the transport-integrity check and the
content-validity check are two checks, and the vendor that owns the first says so about its own
product. A destination that treats a passing digest as a validated record has merged two questions
that this reference keeps apart.

**Protocol Buffers — a reader rejects what it cannot decode rather than accepting it structurally.**
[The proto3 update rules](https://protobuf.dev/programming-guides/proto3/#updating) are explicit
that reusing deleted field numbers produces "ambiguous" decoding, and that unknown fields are lost
when serializing to JSON — the format this repository actually persists in. **Constraint:** the
forward-compatible "keep what you do not understand" property is unavailable here, so a reader that
accepts a shape it did not decode is not being permissive, it is discarding.

**Zod — the failure that locates itself is the one a caller can act on.**
[Error formatting](https://zod.dev/error-formatting) specifies the `path` array on every issue.
**Constraint:** an ingress that refuses a payload must be able to say WHERE it was wrong, or the
person holding an unimportable artifact has a boolean and no next step.

**No comparable reference found** for the narrower question of what a peer-to-peer session handoff
should call a payload that passed integrity and failed decoding; the refusal vocabulary below is
reasoned from this repository's own contract rather than adopted.

## Architecture Review

### Affected Scope

- `packages/agent-session/src/session-artifact.ts` — the artifact deserialize path.
- `packages/agent-session/src/session-record-codec/record-decoder.ts` — loses its duplicate version
  constant (see Decision).
- `packages/agent-framework/src/handoff/handoff-destination.ts` — the integrity-then-decode flow.
- `packages/agent-interface-transport/src/handoff-contracts.ts` — **one union member added.** This is
  the only change outside the two consumer packages and it is deliberate; see Decision.
- Tests in both consumer packages; both packages' `docs/SPEC.md`.
- **Explicitly NOT touched:** `session-store.ts` (issue #2096) and the JSONL replay path
  (issue #2098). `NodeSessionStore` keeps its `// allow-fallback:` marker in this leaf.

### Alternatives Considered

**A. Decode at both ingresses; add one refusal member for a payload that is intact and undecodable
(chosen).**

- Pro: the two failure classes stay distinguishable at the point a caller reads them. A source that
  can retry a truncated transfer and a source running an incompatible build need different actions,
  and only a distinct refusal lets the destination say which happened.
- Pro: the vocabulary member is a contract, which is what an `agent-interface-*` package is for —
  `scan-interface-runtime` refuses a mechanism there and asks for exactly this kind of declaration.
- Con: it widens a published union, which every consumer must tolerate. Measured rather than
  assumed: all five source consumers (`handoff-composition.ts`, `handoff-destination.ts`,
  `session-mobility-contracts.ts`, `handoff-manifest.ts`, `handoff-ownership.ts`) only CARRY the
  value; `git grep "switch (.*refusal"` returns nothing and no `Record<THandoffRefusal, …>` exists,
  so no exhaustive site can be silently left unhandled.

**B. Decode at both ingresses; reuse `integrity-failed` for a decode failure.**

- Pro: no contract change at all; the smallest possible diff.
- Con: **it is false.** Integrity passed — the digest matched and the byte count matched. Reporting
  `integrity-failed` tells a source to retransmit bytes that were already correct, and the retry
  produces the identical refusal forever.
- Con: it re-merges the two questions issue #2067 exists to separate. The tracker's own defect is a
  store that collapsed "corrupt" into "missing"; collapsing "undecodable" into "corrupt bytes" is
  the same error one layer up, and this leaf would be introducing it while fixing the other.

**C. Decode at both ingresses; reuse `destination-cannot-resume`.**

- Pro: no contract change, and it is not literally false — a destination given a malformed record
  cannot resume it.
- Con: it asserts something about the DESTINATION. Malformedness is a property of the payload and
  holds at every destination, so the report attributes the fault to the wrong side. A source reading
  it would reasonably try a different machine.
- Con: `destination-cannot-resume` has a real meaning — this machine lacks a capability the session
  needs — and overloading it makes that meaning unreadable.

**D. Leave handoff alone and decode only the artifact path.**

- Pro: no contract change, and handoff already has an integrity check that catches the common case.
- Con: issue #2097's acceptance criteria name handoff explicitly ("Handoff never stages or persists
  an undecoded record"), and the handoff path is the one with a live trust boundary — the artifact
  path reads a local file, the handoff path accepts a payload from another machine.

### Decision

**Alternative A.** The deciding fact is that the destination's report is the only thing the source
can act on, and the two failure classes require opposite actions: an integrity failure is retried, a
decode failure never is. A vocabulary that cannot express the difference forces the destination to
lie in whichever direction is convenient, which is what B and C each do in a different way.

**Shape, and what each part answers:**

1. **New refusal member: `payload-undecodable`.** Named for the property — the bytes arrived whole
   and the shape is not a record — rather than for the symptom or the actor. `schema-invalid` was
   the alternative and is worse: "schema" implies a declared schema document, while what failed is
   the decode.
2. **Handoff decodes before staging, not before committing.** `receiveChunk` decodes immediately
   after the integrity verdict and discards on failure, so `staged` continues to mean "a record this
   machine could commit". Deferring the decode to `commit()` would leave a destination reporting
   `staged` for a payload it cannot use, and `commit()` is past the point where the source is still
   authoritative.
3. **The artifact importer keeps throwing.** Its contract is throw-based, its callers are written
   for it, and a thrown error carrying the decode issues is strictly more informative than the
   current one. Converting it to an outcome type is a caller migration this leaf's boundary does not
   include, and no consumer has asked for one.
4. **The error message carries the field paths.** Up to a bounded number of issues, so an
   unimportable artifact tells its holder where it is wrong rather than that it is wrong.
5. **`INTERACTIVE_SESSION_RECORD_VERSION` is deleted; `SESSION_ARTIFACT_SCHEMA_VERSION` survives.**
   The two constants are structurally identical duplicates of one number, and the duplicate is the
   one issue #2081 introduced — on an envelope with no producer. The incumbent is published, predates
   it, and is what the producing path actually writes. A fresh duplicate does not displace an
   established public surface; the author of the second name is the wrong party to retire the first.
   No alias is left behind, because a forwarding alias is the shim issue #2079 forbids.
   **The residual question — the surviving name describes its first consumer and will be wrong at
   its second, when issue #2096 wraps a store file in the same envelope — is filed as
   [issue #2185](https://github.com/woojubb/robota/issues/2185) rather than decided here.**
6. **The constant's declaration moves into the codec module; its NAME and its export from the
   package barrel do not change.** `session-artifact.ts` will import the decoder, so leaving the
   constant there and having the codec import it back would create a module cycle. Moving the
   declaration and keeping `SESSION_ARTIFACT_SCHEMA_VERSION` exported from `@robota-sdk/agent-session`
   leaves the public surface byte-identical.
7. **`ISessionArtifact` is deleted in favour of `IVersionedInteractiveSessionRecord`.** Same members,
   same types — one shape with two names. **Nothing on disk changes:** an artifact written before
   this change parses identically after it, because the shape being unified is already the same
   shape. That is what keeps this leaf clear of the externally-visible-format line that places
   issue #2096 outside the delegated class, and the distinction is load-bearing rather than
   incidental.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — "Affected Scope" above; three packages written, two paths
      (store, JSONL) explicitly excluded with the issues that own them.
- [x] Sibling scan 완료 — the sibling ingresses were read before choosing: `NodeSessionStore.load`
      (`session-store.ts:89-95`), `WorkspaceSessionStore.load` (`workspace-session-store.ts:55-63`),
      and `validateSessionReplayLogEntries` (`session-log-validation.ts`), which returns
      `{ ok, issues[] }`. The artifact path's throw-based contract is kept because its callers are
      written for it, NOT because it is the better shape — the sibling that returns issues is, and
      issue #2096 is where that form lands.
- [x] 대안 최소 2개 검토 완료 — four alternatives with pro/con above.
- [x] 결정 근거 문서화 완료 — Decision names the deciding fact (the two failure classes require
      opposite actions from the source) and the seven shape decisions with their reasons.
- [x] New-surface placement — **N/A: no new package, app, or presentation/interface surface.** One
      member is added to an existing union in the package that already owns it, which is the kind of
      declaration `scan-interface-runtime` says an interface package SHOULD publish.

## Fallback & Degradation Declaration

None.

This change removes a permissive path rather than adding one. The `// allow-fallback:` marker in
`session-store.ts` is untouched and belongs to issue #2096; the one in `workspace-session-store.ts`
likewise. Neither ingress this leaf touches gains a degraded path: each either produces a decoded
record or refuses with a located reason.

## Solution

**`packages/agent-interface-transport/src/handoff-contracts.ts`** — one member on `THandoffRefusal`:

```ts
export type THandoffRefusal =
  | 'integrity-failed'
  /** The bytes arrived whole and did not decode as a session record. Never retried: a
      retransmission produces the identical payload and the identical refusal. */
  | 'payload-undecodable'
  | 'unauthorized'
  …
```

**`packages/agent-session/src/session-artifact.ts`** — the envelope check and the record check become
one call:

```ts
export function deserializeSessionArtifact(bytes: string): IInteractiveSessionRecord {
  const outcome = decodeVersionedInteractiveSessionRecord(JSON.parse(bytes) as unknown);
  if (outcome.status === 'unsupported')
    throw new Error(/* names the version seen and the one read */);
  if (outcome.status === 'corrupt') throw new Error(/* names up to N issue paths */);
  return outcome.record;
}
```

`ISessionArtifact` and the local envelope checks are deleted; `SESSION_ARTIFACT_SCHEMA_VERSION`'s
declaration moves to the codec and its export from the package barrel is unchanged.

**`packages/agent-framework/src/handoff/handoff-destination.ts`** — decode between the integrity
verdict and `staged`:

```ts
if (!verdict.intact) return this.discard('integrity-failed', …);
const outcome = decodeInteractiveSessionRecord(JSON.parse(result.serialized ?? '') as unknown);
if (outcome.status !== 'valid') return this.discard('payload-undecodable', …);
this.record = outcome.record;
this.state = 'staged';
```

A malformed JSON body is caught and discarded as `payload-undecodable` too — `JSON.parse` throwing
is the same class of failure as decoding failing, and an exception escaping `receiveChunk` would
leave the destination in `receiving` with no report.

## Affected Files

| File                                                                | Change                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/agent-interface-transport/src/handoff-contracts.ts`       | one `THandoffRefusal` member                             |
| `packages/agent-interface-transport/docs/SPEC.md`                   | the refusal vocabulary row                               |
| `packages/agent-session/src/session-artifact.ts`                    | decode via the codec; `ISessionArtifact` removed         |
| `packages/agent-session/src/session-record-codec/record-decoder.ts` | duplicate constant removed; incumbent name declared here |
| `packages/agent-session/src/session-record-codec/index.ts`          | export list follows                                      |
| `packages/agent-session/src/index.ts`                               | export list follows                                      |
| `packages/agent-session/src/__tests__/session-artifact.test.ts`     | malformed corpus                                         |
| `packages/agent-session/docs/SPEC.md`                               | artifact + codec sections                                |
| `packages/agent-framework/src/handoff/handoff-destination.ts`       | decode before staging                                    |
| `packages/agent-framework/src/handoff/__tests__/…`                  | handoff malformed corpus                                 |
| `packages/agent-framework/docs/SPEC.md`                             | handoff refusal behaviour                                |
| `.agents/tasks/TRANS-006-…​.md`                                     | status/plan                                              |

## Completion Criteria

- [x] TC-01: `deserializeSessionArtifact` throws for every member of a malformed-record corpus that
      currently deserializes successfully — a record whose `id` is a string and whose `messages` is
      not an array is the representative case — and the thrown message contains the offending field
      path.
- [x] TC-02: `deserializeSessionArtifact(serializeSessionArtifact(record))` still round-trips a
      valid maximal record to a deep-equal value, with `messages[].timestamp` a `Date`.
- [x] TC-03: An artifact whose `schemaVersion` this build does not read throws an error naming both
      the version seen and the version read, and does NOT report field issues.
- [x] TC-04: `HandoffDestination.receiveChunk` refuses a payload that passes integrity and fails to
      decode with `refusal: 'payload-undecodable'`, and the destination state is not `staged`.
- [x] TC-05: A payload that fails integrity still refuses with `integrity-failed` — the two refusals
      are produced by different conditions and neither is reachable by the other's input.
- [x] TC-06: After a `payload-undecodable` refusal, `commit()` does not return a record, and
      `getCommittedRecord()`-equivalent access yields nothing.
- [x] TC-07: A payload whose bytes are not JSON at all is refused as `payload-undecodable` rather
      than escaping as an exception from `receiveChunk`.
- [x] TC-08: A valid handoff payload still stages and commits unchanged, with revived `Date`s.
- [x] TC-09: `SESSION_ARTIFACT_SCHEMA_VERSION` is still exported from `@robota-sdk/agent-session`
      with the same name and value; `INTERACTIVE_SESSION_RECORD_VERSION` is gone from the public
      surface; `grep` finds no alias or re-export bridging the two.
- [x] TC-10: `pnpm build` then `pnpm -w typecheck` pass — the union widening breaks no consumer, and
      the check is run against a freshly built `dist/`.
- [x] TC-11: `node scripts/harness/run-all-scans.mjs` passes, including `interface-runtime`
      (the added member is a contract, not a mechanism) and `deps`.
- [x] TC-12: All three touched packages' `docs/SPEC.md` describe the new behaviour, and
      `check-spec-public-surface.mjs` passes.

## Test Plan

| TC-ID | Test Type         | Tool / Approach                                                                  | Notes                                                                |
| ----- | ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| TC-01 | Unit (corpus)     | vitest — table-driven over malformed artifacts in `session-artifact.test.ts`     | Each case asserts the thrown message contains the field path         |
| TC-02 | Unit              | vitest — round-trip of the maximal record fixture                                |                                                                      |
| TC-03 | Unit              | vitest                                                                           | Asserts absence of field-issue text, so the classes stay apart       |
| TC-04 | Unit              | vitest — handoff destination driven through manifest → chunks → verdict          | Uses the existing handoff test composition                           |
| TC-05 | Unit (paired)     | vitest — one input fails integrity, one passes integrity and fails decode        | The pairing is the assertion; neither refusal reachable by the other |
| TC-06 | Unit              | vitest                                                                           |                                                                      |
| TC-07 | Unit              | vitest — non-JSON bytes with a matching digest                                   | Digest computed over the bad bytes so integrity genuinely passes     |
| TC-08 | Unit              | vitest — the existing happy-path handoff test, extended to assert `Date` revival |                                                                      |
| TC-09 | Unit + grep       | vitest imports the constant from the package entry; `git grep` for an alias      |                                                                      |
| TC-10 | Build / typecheck | `pnpm build` then `pnpm -w typecheck`                                            | Build FIRST — a stale `dist/` reports phantom cross-package errors   |
| TC-11 | Scan              | `node scripts/harness/run-all-scans.mjs`                                         |                                                                      |
| TC-12 | Scan + review     | `node scripts/harness/check-spec-public-surface.mjs`                             |                                                                      |

## User Execution Test Scenarios

Not applicable is **not** claimed. This leaf changes what a user observes: an artifact that would
previously import as a broken session now refuses with a located reason. The surface is public SDK
usage of a published package, which `backlog-execution.md` names as a product surface.

### UES-01 — a malformed artifact is refused, and says where

- **Agent-executability:** `agent-executable`.
- **Prerequisite:** `pnpm --filter @robota-sdk/agent-session build` — the scenario runs against
  `dist/`, the artifact a consumer installs, not against source.
- **Exact command:**

  ```bash
  node --input-type=module -e "
  import { deserializeSessionArtifact, serializeSessionArtifact, SESSION_ARTIFACT_SCHEMA_VERSION } from './packages/agent-session/dist/node/index.js';
  const record = { id: 's1', cwd: '/w', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: new Date('2026-08-01T00:00:01.000Z'), state: 'complete' }] };
  const ok = deserializeSessionArtifact(serializeSessionArtifact(record));
  console.log('1', ok.messages[0].timestamp instanceof Date);
  try { deserializeSessionArtifact(JSON.stringify({ schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION, record: { id: 'x', messages: 'not-an-array' } })); console.log('2 NO-THROW'); }
  catch (e) { console.log('2', /messages/.test(e.message)); }
  try { deserializeSessionArtifact(JSON.stringify({ schemaVersion: 99, record })); console.log('3 NO-THROW'); }
  catch (e) { console.log('3', /99/.test(e.message), /expected/.test(e.message)); }
  "
  ```

- **Expected observable result** — exit code 0 and exactly these three lines:

  ```
  1 true
  2 true
  3 true false
  ```

  Line 1 is the round trip decoding to a real `Date`. Line 2 is a malformed record refused with the
  offending field named — `id` is a string, so this payload imported successfully before this leaf.
  Line 3 carries two assertions in one: the version error names `99`, AND it contains no `expected`
  text, which is how `unsupported` is shown to be distinguishable from `corrupt` rather than merely
  differently worded. A `NO-THROW` on lines 2 or 3 is the failure this scenario exists to catch.

- **Cleanup:** none — the scenario writes nothing and starts no process.
- **Evidence field:** recorded in the Evidence Log under `[DONE-GATE-STAGE-2]`.

## Tasks

- [x] TRANS-006 — done — `.agents/tasks/completed/TRANS-006-artifact-and-handoff-ingestion-decode-before-they-commit.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block, `status: draft`, `type: DATA` (member of the 11-prefix list), `tags`
  present.
- Problem — concrete symptoms, both cited to file and line: the artifact importer's envelope-plus-`id`
  check (`session-artifact.ts:62-83`) and the handoff destination's integrity-then-cast
  (`handoff-destination.ts:98-111`). Each symptom quotes the code's OWN comment stating the intent it
  falls short of, which is stronger evidence than my paraphrase.
- Problem — reproduction condition: a concrete payload that deserializes successfully today
  (`{"schemaVersion":1,"record":{"id":"x","messages":"not-an-array"}}`) and the existing test line
  that hands such a value to `store.save`.
- No "TBD"/"TODO"/vague language: `grep -nE "TBD|TODO|works correctly|no errors|displays correctly"`
  returns nothing outside the Tasks placeholder the template requires.
- Prior Art Research: three documentation citations —
  <https://docs.cloud.google.com/storage-transfer/docs/data-integrity> (a checksum mismatch fails
  with a named `DATA_LOSS` error, and the same page recommends "additional data integrity checks"
  because its own validation "may not be sufficient"),
  <https://protobuf.dev/programming-guides/proto3/#updating>, and <https://zod.dev/error-formatting>.
  Each is stated as a constraint that applies here, and the absence of a reference for the narrower
  handoff-vocabulary question is stated explicitly rather than left blank. The Storage Transfer
  citation is what makes alternative B's rejection evidence-based rather than asserted: the vendor
  that owns the integrity check says integrity is its own outcome and is not sufficient alone.
  `node scripts/harness/scan-spec-research.mjs` — passed.
- Architecture Review Checklist: all 4 `[x]`. Sibling scan `[x]` with named evidence — the three
  sibling ingresses were read (`NodeSessionStore.load`, `WorkspaceSessionStore.load`,
  `validateSessionReplayLogEntries`) and the outcome records that the throw-based contract is kept
  for caller reasons, NOT because it is the better shape. New-surface placement `N/A` with reason.
- Alternatives Considered: 4 entries with explicit pro/con. B and C are the two that would avoid a
  contract change, and both are rejected on correctness rather than taste — B reports a retryable
  failure for one that can never succeed on retry; C attributes a payload property to the destination.
- Completion Criteria: 12 items, all `TC-N` prefixed (`grep -c` = 12), each a command form or an
  observable-behaviour form.
- Test Plan: 12 rows (`grep -cE` = 12), matching one-to-one. Every row has a non-empty type and
  tool; none is "manual".
- User Execution Test Scenarios: present, not-applicable NOT claimed, scenario written with the
  agent-executability decision, prerequisite, command, literal expected output, cleanup and evidence
  field. `scan-spec-user-execution-section` governs `active/` and `done/`; the section is written
  before implementation as the rule requires, not retrofitted at the folder transition.
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present and empty before this
  entry; no `## Status` or `## Classification` in the body.
- `node scripts/harness/check-spec-doc-frontmatter.mjs` — passed (290 documents).

**Recorded by:** this session, judged against the gate catalogue's GATE-WRITE criteria directly. The
`backlog-gate-guard` subagent was not dispatched, because this session operates under a user
instruction not to invoke the Agent tool.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

**Prior gate:** GATE-WRITE shows PASS above; input status `review-ready` in `.agents/spec-docs/backlog/`.

**Form of approval: the owner's standing delegation, recorded in the three parts
`backlog-execution.md` § "Standing authorization" requires.**

**(1) The delegation, verbatim.** The owner's session-opening instruction to the orchestrating
session:

> 지금부터 깃헙 이슈에 등록된 것들을 처리할 것인데, 이슈들은 순서를 잘 맞춰서 처리해야함. 그렇기 때문에
> 너에게 오케스트레이션 권한을 줄테니 다른 세션들과 의사소통 하면서 이슈들을 나눠서 처리해줘.

and, on the GATE-APPROVAL question put to them explicitly, the owner SELECTED the option
`위임 선언 — 이슈 처리 전권`:

> 「근거가 타당하면 스스로 승인하고 진행하라」는 취지의 표준 위임을 지금 선언해 주시면, 각 spec의
> Evidence Log에 그 문장을 그대로 인용하고 + 근거 조건 충족을 입증하고 + 해당 항목이 위임 범위 안임을
> 보여서 GATE-APPROVAL을 통과시킵니다.

**Provenance, stated rather than smoothed over:** this reached this session RELAYED by the
orchestrating session, not typed into its conversation, and the owner selected an offered option
rather than composing a sentence. A peer session cannot grant approval on the owner's behalf and
this entry does not claim it did.

**(2) The evidence condition is satisfied for THIS item.** The delegation is conditional on 근거 —
sound reasoning — not unconditional:

- Both symptoms are verified against the code and cited to file and line, and each is evidenced by
  the code's OWN comment stating an intent it does not meet — the handoff file says "Nothing is
  parsed before the integrity check passes" and then casts without decoding after it.
- The design was checked against the constraint that would invalidate it BEFORE it was chosen: all
  five source consumers of `THandoffRefusal` were enumerated and none switches exhaustively over it
  (`git grep "switch (.*refusal"` empty, no `Record<THandoffRefusal, …>`), so widening the union
  cannot silently leave a case unhandled.
- The two alternatives that would avoid a contract change are rejected on correctness, not taste:
  `integrity-failed` is false because integrity passed and would send a source to retry bytes that
  were already correct; `destination-cannot-resume` attributes to the destination a property of the
  payload that holds at every destination.
- Prior art constrains rather than decorates: the vendor that owns an integrity check documents it
  as its own named outcome AND as insufficient alone, which is the exact claim alternative B denies.
- A residual question the leaf could have quietly settled in its own favour was filed instead —
  [issue #2185](https://github.com/woojubb/robota/issues/2185), on the surviving constant's name
  being wrong at its second consumer.

**(3) The item sits inside the delegated class.** Against the four exclusions a standing
authorization never covers:

- _Product direction / user-facing scope_ — none beyond what issue #2097 already specifies.
- _A published or externally visible contract_ — **checked, and this is the one that needs stating.**
  One member is ADDED to a published union, which widens rather than narrows: no existing value
  changes meaning and no consumer is broken (verified above). `ISessionArtifact` is replaced by a
  structurally identical type and `SESSION_ARTIFACT_SCHEMA_VERSION` keeps its name, value and export,
  so **no byte on disk changes and no published name disappears**: an artifact written before this
  change parses identically after it. That is what keeps this leaf clear of the
  externally-visible-format line that places issue #2096 outside the delegated class, and the
  distinction is load-bearing — if it blurred, this item would belong with issue #2096 and not here.
- _Business / legal / strategic judgement_ — none.
- _A practice this repository has never used before_ — none; the change follows the same shape as
  TRANS-005 and reuses its codec.
- _Repository-wide policy files_ — untouched. No lint config, CI workflow, git hook, or workspace
  topology file appears in Affected Files.

**Independent architecture validation (conditional):** N/A — no new package, app or interface
surface, and no layer or product-family reclassification.

**No Architecture Review or frontmatter `type`/`tags` change is made after this entry.**

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-23

**Status upgrade:** approved → in-progress

**Prior gate:** GATE-APPROVAL shows PASS immediately above; input status `approved`.

- Task file exists:
  `.agents/tasks/TRANS-006-artifact-and-handoff-ingestion-decode-before-they-commit.md`.
- **How the ID was obtained, and why the allocator was run.** The orchestrating session assigned
  `TRANS-006` from its ledger and said not to self-allocate. `.agents/tasks/README.md` requires the
  ID and the record to be created in ONE operation, precisely to close the read-then-write window.
  Both are satisfiable together: `--dry-run` was run first and printed `TRANS-006`, agreeing with the
  assigned ID, so running the allocator for real claimed the number the orchestrator had already
  chosen rather than a different one. Had it printed anything else, that disagreement would itself
  have been the finding. 1458 claimed ids examined — 883 records, 1447 citations, 87 issue titles.
- Task file path is recorded in this document's `## Tasks` section.
- Task correspondence: the task's `## Plan` carries one entry per TC-N, TC-01 through TC-12, twelve
  against twelve.
- Test Plan section: present, ~1,300 characters, naming both test files, both runner commands, the
  fixture strategy, and the reason TC-05's pairing is the assertion that matters.

### [OWNER DECISION — the redact seam] — recorded | 2026-08-23

The Architecture Review left one question open deliberately, as class 3 under
`backlog-execution.md` § Agent Decision Authority: the share path's `redact` produced artifacts
missing a REQUIRED member (`cwd`), asserted by `session-artifact.test.ts` TC-08, and a total decoder
refuses those.

**Decision: keep the workflow, change the mechanism. A `redact` must return a record.** Removing a
host path is `{ ...record, cwd: '' }`, not `delete`. The share workflow — strip path, import on
another surface, rebind there — is unchanged and no user capability is lost.

Three facts were verified before the question was put, and they are what the decision rests on:
the seam's type is `(record: IInteractiveSessionRecord) => IInteractiveSessionRecord`, a total
function on records; `cwd: string` is required; and the SPEC's "policy-free" governs which FIELDS the
app removes, not whether the result is still a record. The capability being withdrawn was reached by
two casts — `rest as IInteractiveSessionRecord` in the redact and `as unknown as
IInteractiveSessionRecord` in the fixture it operated on — never by the contract.

**This is therefore not a contract change.** An input the type never permitted now fails loudly with
a located reason instead of silently producing a partial session that reached the store through
`storeB.save(...)`. For any app whose redact was type-legal, nothing moves.

Rejected alternative, recorded: a separate "partial artifact" decode mode for the share path. It
reintroduces exactly one permissive reader in the one place a payload crossed a machine boundary, and
takes the shim shape issue #2079 forbids.

### [GATE-VERIFY] — ✅ PASS | 2026-08-23

**Prior gate:** GATE-IMPLEMENT shows PASS above; input status `in-progress` in `active/`.

- Task file: 12 of 12 `[x]`, none blocked or pending.
- Build: `pnpm build` — whole workspace, clean.
- Typecheck: `pnpm -w typecheck` — clean. **Stated with its limit, because the limit is real:**
  `packages/agent-session/tsconfig.json` excludes `**/*.test.ts`, so that run did NOT cover the two
  test files this leaf changed most. They were typechecked separately against a throwaway config that
  drops the exclusion (created, run, deleted — nothing left in the tree): **0 errors in this leaf's
  files**, alongside 58 pre-existing errors in 14 other test files that the exclusion is currently
  load-bearing for. Measured and contributed to issue #2192 rather than fixed here.
- Tests: `agent-session` 46 files / 332 tests; `agent-framework` 186 / 1456; `agent-cli` 54 / 423.
  All passing. Whole-package suites, not just the new files — three of the fixtures this leaf had to
  correct live in suites it does not otherwise touch.
- Scans: `node scripts/harness/run-all-scans.mjs` — **139 passed, 2 skipped, 0 failed**, including
  `interface-runtime` (the added member is a contract, not a mechanism), `deps`,
  `contract-cast-ratchet`, `spec-public-surface`, `spec-user-execution-section`, `doc-folder-status`.

**Evidence that could have passed without running, and what was done about it.** The exhaustiveness
claim — no site switches over `THandoffRefusal`, so widening it breaks nothing — rests on a search
returning nothing, and a BROKEN search returns nothing too. Each negative was therefore paired with a
positive control of the same command shape:

```
POSITIVE  git grep -n "switch ("                       -- …/session-record-codec   → hit,  exit 0
NEGATIVE  git grep -nE "switch \([^)]*refusal"          -- packages                 → none, exit 1
POSITIVE  git grep -nE "Record<T[A-Za-z]+, "            -- …/src                    → 3 hits, exit 0
NEGATIVE  git grep -nE "Record<THandoffRefusal"         -- packages                 → none, exit 1
```

`git grep` exit 1 is "ran and matched nothing"; exit 2 is "failed". The negatives are meaningful
rather than merely empty.

**Red before green, demonstrated rather than asserted.** The handoff suite was written first and run
against the OLD implementation — all 9 cases failed, with `staged` reached for payloads that are not
records and `timestamp` still a string. Rebuilding `agent-framework` and re-running turned them
green. That is a stronger claim than a module-not-found red: the tests failed against the behaviour
this leaf replaces.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-23

UES-01 is fully written: agent-executability decision, prerequisite build step, the exact command,
the expected observable as three literal lines with what each proves, cleanup, and the evidence
field. Executability was established by running the command before this entry was written, not
asserted after. Not-applicable is not claimed — the leaf changes what a user observes when importing
an artifact, and public SDK usage is a product surface under `backlog-execution.md`.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-23

UES-01 executed against `packages/agent-session/dist/node/index.js` — the built artifact, not source.

Observed — exit code 0, identical to the expectation authored before the run:

```
1 true
2 true
3 true false
```

Line 1: the round trip produced a real `Date`. Line 2: a record whose `id` is a string and whose
`messages` are not an array was refused with `messages` named — that exact payload imported
successfully before this leaf. Line 3: the version error names `99` AND carries no `expected` text,
which is the observable form of `unsupported` and `corrupt` being different outcomes rather than
different wording.

**Durable artifacts:** `packages/agent-session/src/__tests__/session-artifact.test.ts`,
`packages/agent-cli/src/__tests__/handoff-decode.test.ts`,
`packages/agent-framework/src/handoff/handoff-destination.ts`,
`packages/agent-session/src/session-artifact.ts`.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-23

**Status upgrade:** verifying → done

Test references name the file and the `describe` that owns each criterion.

- **[GATE-COMPLETE: TC-01]** `pnpm --filter @robota-sdk/agent-session test`. Seven malformed
  artifacts — `messages` not an array, a message with no timestamp, a state outside the union, an
  unparseable `updatedAt`, a goal missing required members, an undeclared member, and a required
  member DELETED by a redact — each throws with the offending path in the message. Test:
  `session-artifact.test.ts > the record is decoded, not cast (TRANS-006) > refuses %s and names %s`.
- **[GATE-COMPLETE: TC-02]** A valid maximal record still round-trips deep-equal with `Date`
  timestamps. Test: `> round-trip fidelity (TC-01) > deserialize(serialize(record)) deep-equals`.
- **[GATE-COMPLETE: TC-03]** `schemaVersion: 999` throws naming the version and — asserted
  separately — does NOT match `/expected/`, so no field issues leak into a version failure. Test:
  `> reports an unsupported version without field issues — the two classes stay apart`.
- **[GATE-COMPLETE: TC-04]** Five intact-but-undecodable payloads refuse `payload-undecodable` with
  state `discarded`, never `staged`. Test: `handoff-decode.test.ts > TC-04/TC-06 > refuses %s as
payload-undecodable`.
- **[GATE-COMPLETE: TC-05]** Paired: bytes altered in flight refuse `integrity-failed`; bytes intact
  with a wrong shape refuse `payload-undecodable`. The pairing IS the assertion — a suite checking
  only "it refused" would pass against an implementation that collapsed the two. Test:
  `> TC-05: integrity failure and decode failure are different refusals`.
- **[GATE-COMPLETE: TC-06]** After the refusal `liveRecord()` is null and `persist` was never called
  — asserted in the same case as TC-04, because "not staged" and "nothing was written" are two
  claims.
- **[GATE-COMPLETE: TC-07]** A JSON array where a record belongs is refused rather than escaping as
  an exception; the artifact side has the matching case for non-JSON bytes
  (`> reports bytes that are not JSON as an artifact failure, not a raw SyntaxError`).
- **[GATE-COMPLETE: TC-08]** The valid handoff still stages, commits, and yields a `Date` —
  `expect(live?.messages[0]?.timestamp).toBeInstanceOf(Date)`. Before this leaf the destination cast
  it back and the declared `Date` was a lie on the receiving side. Test: `> TC-08`.
- **[GATE-COMPLETE: TC-09]** `SESSION_ARTIFACT_SCHEMA_VERSION` is 1 and is what the producer writes;
  `INTERACTIVE_SESSION_RECORD_VERSION` appears nowhere in `packages/agent-session/src`
  (`grep -c` = 0) and no alias bridges them. Test: `> one version constant, not two (TRANS-006)`.
- **[GATE-COMPLETE: TC-10]** `pnpm build` → clean; then `pnpm -w typecheck` → clean, with the
  `agent-session` test-exclusion limit recorded under GATE-VERIFY and the leaf's own test files
  typechecked separately at 0 errors. Build precedes typecheck deliberately: a stale `dist/` reported
  a phantom `payload-undecodable is not assignable to THandoffRefusal` during this work, which
  disappeared on rebuild.
- **[GATE-COMPLETE: TC-11]** `node scripts/harness/run-all-scans.mjs` → 139 passed, 2 skipped, 0
  failed.
- **[GATE-COMPLETE: TC-12]** `node scripts/harness/check-spec-public-surface.mjs` → passed. Updated:
  `agent-interface-transport/docs/SPEC.md` (the refusal vocabulary and why the two are kept apart),
  `agent-session/docs/SPEC.md` (the importer decodes; a redact must return a record; one version
  constant), `agent-framework/docs/SPEC.md` (`HandoffDestination` stages only what decodes).

**Test Plan coverage — every row addressed.** TC-01…TC-09 are automated at the `describe` names
above. TC-10, TC-11 and TC-12 are build/scan rows: each names its command and observed result here,
and no unit test duplicates them, because the harness scan IS the automated check and a vitest
wrapper would assert the scan's result rather than the property.

**Three fixtures corrected, and why that is in scope rather than creep.** Routing the artifact
importer through the decoder turned red three fixtures in three packages that had been green since
they were written — each a stub cast past its contract, two of them asserting round-trip fidelity for
a value that was never a session record. They are corrected here because this leaf is what made them
falsifiable. The class is filed as issue #2190 (the contract-cast ratchet governs three contracts and
not this one), with the compiler-view half on issue #2192.

**Summary.** 12 of 12 criteria met and evidenced. 2,211 tests green across the three affected
packages. 139 scans pass. The user-execution scenario ran against the built artifact and matched an
expectation authored before implementation. One question was correctly not answered inside this leaf
— the redact seam — and came back from the owner as the recommendation this document proposed.
