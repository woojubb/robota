---
status: done
type: DATA
tags: [session, persistence, codec, store, resume]
---

# TRANS-007: a session store that cannot say why a load failed destroys the file on the next save

Design for Task
[`.agents/tasks/completed/TRANS-007-store-loads-say-which-of-the-four-things-happened.md`](../../tasks/completed/TRANS-007-store-loads-say-which-of-the-four-things-happened.md),
the execution leaf [issue #2096](https://github.com/woojubb/robota/issues/2096) under tracker
[issue #2067](https://github.com/woojubb/robota/issues/2067). Follows
[issue #2081](https://github.com/woojubb/robota/issues/2081) (the decoder) and
[issue #2097](https://github.com/woojubb/robota/issues/2097) (artifact and handoff ingestion).

## Problem

`IInteractiveSessionStore.load` returns `IInteractiveSessionRecord | undefined`
(`packages/agent-interface-transport/src/session-contracts.ts:478`). **`undefined` is the whole
defect**: it is one value for four different situations — the session was never saved, the file is
damaged, the file was written by a build this one cannot read, or the read itself failed. Every
consumer therefore has to guess, and they guess differently.

**Symptom 1 — a corrupt session resumes as an EMPTY session, silently.**
`loadSessionRecord` (`packages/agent-framework/src/interactive/interactive-session-restore.ts:61`)
does `const record = sessionStore.load(resumeSessionId); if (!record) { return { history: [], … } }`
— fifteen empty members. A user who runs `--resume` on a damaged file is not told anything. They get
a session that looks new, with their conversation, goal, plan and branch pointer all absent.

**Symptom 2 — and then the next save DESTROYS the file.** `persistSession`
(`packages/agent-session/src/session-history-ops.ts:174`) reads the existing record to preserve the
fields it does not own — `const existing = ctx.sessionStore.load(ctx.sessionId)` — then builds
`{ ...existing, id, cwd, createdAt: existing?.createdAt ?? now, … }` and calls `save`. When
`existing` is `undefined` **because the file was corrupt rather than absent**, the spread contributes
nothing and the save overwrites the damaged file with a fresh, nearly empty record. The same
read-modify-write shape is at
`packages/agent-framework/src/interactive/interactive-session-persistence.ts:56`.

So the collapse is not only a reading defect. A file that might have been recoverable by hand is
overwritten by the next autosave, and the window between the two is however long the user keeps
typing.

**Symptom 3 — a rename that appears to work and does not.** `setName`
(`packages/agent-framework/src/interactive/interactive-session.ts:758`) does
`const existing = this.sessionStore.load(id); if (existing) { … save … }`. On an unreadable file the
`if` is simply false: no error, no message, and the name is not persisted.

**Symptom 4 — unreadable sessions vanish from the list rather than being reported.**
`NodeSessionStore.list` skips files it cannot parse (`session-store.ts:113`, `// Skip malformed
files`), and `WorkspaceProjectSessionStore.list` maps over `load` and filters `undefined` out
(`workspace-session-store.ts:72`). A user browsing their sessions does not see a damaged one at all
— it reads as _gone_, not as _unreadable_.

**Symptom 5 — `unsupported` is unreachable, because nothing on disk carries a version.** Both stores
persist `JSON.stringify(session)` — the bare record (`session-store.ts:70`,
`workspace-session-store.ts:45`). There is no version field to compare, so "written by a build this
one does not read" cannot be told from "damaged" even in principle.

**Reproduction condition (all five):** truncate any file in `~/.robota/sessions/` — `head -c 200
file.json > tmp && mv tmp file.json` — then `--resume` that session, type once, and look at the file
again.

## Prior Art Research

**Question.** When a store cannot return the value it was asked for, is "absent" an acceptable stand-in
for "present and unreadable", and what do systems that separate them gain?

**HTTP — the two are different status classes, and the distinction is the specification's.**
[RFC 9110 §15.5.5](https://www.rfc-editor.org/rfc/rfc9110#name-404-not-found) defines 404 as the
origin server not finding a current representation, while
[§15.6.1](https://www.rfc-editor.org/rfc/rfc9110#name-500-internal-server-error) defines 500 as the
server encountering an error that prevented it fulfilling the request. **Constraint that applies to
Robota:** a caller retries, reports, or falls back differently for the two, which is why the
specification does not let one stand for the other. A store returning `undefined` for both has
merged what the most-deployed protocol in existence keeps apart.

**Git — a damaged object is an error, never an absence.** The
[`git fsck` documentation](https://git-scm.com/docs/git-fsck) verifies connectivity and validity and
reports corrupt objects; `git cat-file` on a damaged object fails rather than reporting the object as
missing. **Constraint:** the system that most aggressively deduplicates and content-addresses its
storage still refuses to let corruption read as absence, because the recovery for the two is
different — one is re-fetch, the other is repair from a replica.

**SQLite — corruption is its own result code, and the guidance is explicitly against overwriting.**
[`SQLITE_CORRUPT`](https://www.sqlite.org/rescode.html#corrupt) is a distinct result code from
`SQLITE_NOTFOUND`, and the [How To Corrupt](https://www.sqlite.org/howtocorrupt.html) document is
largely a catalogue of ways a well-meaning writer destroys recoverable data. **Constraint — this is
the one that matters most here:** the danger is not the bad read, it is the write that follows it.
Symptom 2 is exactly that shape.

**No comparable reference found** for the narrower question of what a resumable-agent-session store
should show a user whose session was written by an older build; the design below reasons from this
repository's own outcome vocabulary rather than adopting one.

## Architecture Review

### Affected Scope

- **The port:** `packages/agent-interface-transport/src/session-contracts.ts` —
  `IInteractiveSessionStore.load` and `.list` signatures, plus the outcome type.
- **Both implementations:** `packages/agent-session/src/session-store.ts` (`NodeSessionStore`) and
  `packages/agent-framework/src/interactive/workspace-session-store.ts`
  (`WorkspaceProjectSessionStore`). The second one also owns the replay fallback this leaf must gate.
- **Nine call sites**, across four packages including `apps/`: `interactive-session-restore.ts:61`,
  `interactive-session-persistence.ts:56`, `interactive-session.ts:758`,
  `workspace-session-store.ts:72`, `scripted-session-harness.ts:367`, `session-history-ops.ts:174`,
  `apps/agent-server/src/routes/handlers/playground-session-create.ts:161`, and two `examples/`.
- **The summary projection:** `listResumableSessionSummaries`
  (`packages/agent-framework/src/interactive/session-persistence.ts`).
- **Explicitly NOT in scope:** the JSONL replay decoder itself (issue #2098). This leaf gates WHEN
  replay runs; it does not change what replay decodes.

### Alternatives Considered

**A. A typed load outcome on the port, an envelope on disk, and a write-path guard (chosen).**

- Pro: it is the only shape in which `unsupported` exists at all — with no version on disk there is
  nothing to compare, so the acceptance criterion cannot be met without the format change.
- Pro: it fixes Symptom 2 structurally rather than by care. A read-modify-write consumer that must
  match on an outcome cannot accidentally treat `corrupt` as "no prior record"; the compiler asks.
- Con: it changes a published port signature and moves nine call sites, one of them in `apps/`.
- Con: **no existing session file resumes.** A file written before this has no version field and
  decodes as `unsupported`. This is an accepted cost, not an oversight — see Decision.

**B. Keep `load(): record | undefined` and add a separate `diagnose(id)` method.**

- Pro: no call site moves; every consumer keeps working unchanged.
- Con: the default path stays wrong. A consumer gets `undefined` and has to remember to ask a second
  question — and the two consumers that destroy data (Symptom 2) are exactly the ones that would not
  bother, because they are not trying to diagnose anything, they are trying to save.
- Con: it makes the honest answer opt-in. Every defect in this issue exists because the cheap path
  and the correct path were different paths.

**C. Write the envelope but keep the collapse, and only fix the resume fallback.**

- Pro: satisfies the literal acceptance line about replay running only for `missing`.
- Con: leaves Symptoms 2, 3 and 4 in place. The tracker's defect is the collapse itself, and a leaf
  that fixes one consumer of a collapsed value while leaving the value collapsed has not removed it.

**D. Add a compatibility branch that reads a bare record as version 0.**

- Pro: existing sessions keep resuming; no user-visible loss.
- Con: **it is the permissive reader issue #2067 exists to remove**, reintroduced in the exact place
  the tracker names. And the owner has ruled directly on this
  ([issue #2096 comment](https://github.com/woojubb/robota/issues/2096)): _"우리는 구버전 호환이라는게
  없다고 규칙에 적혀있어요. 레거시는 고려하지 마세요. 아직 출시 전입니다."_ —
  `code-quality.md:58-59`, pre-release, legacy disposable.

### Decision

**Alternative A.** The deciding fact is Symptom 2: the collapse is not merely uninformative, it is
destructive, and no amount of care at the call sites removes a defect whose cheap path is the wrong
one. A type that forces the caller to say which outcome it is handling is the only version of this
fix that stays fixed.

**Shape, and what each part answers:**

1. **`load(id): TSessionLoadOutcome`** — `valid` / `missing` / `corrupt` / `unsupported`, reusing the
   decoder's issue vocabulary from issue #2081 for `corrupt` so a caller can say WHERE the file is
   wrong, not merely that it is.
2. **`missing` is a first-class outcome here, unlike in the decoder.** TRANS-005 deliberately gave
   the decoder no `missing` member, because absence is a property of a store rather than of a value.
   This is the store. It composes its own `missing` with the decoder's three, which is exactly the
   split that design predicted.
3. **The store writes `{ schemaVersion, record }`**, the same envelope the artifact path already
   carries since issue #2097. One persisted shape, one version constant, one decoder.
4. **A read-modify-write consumer must not treat a non-`valid` load as "no prior record".** On
   `corrupt` or `unsupported`, `persistSession` and its siblings **refuse to write** rather than
   overwriting. That is the fix for Symptom 2 and it is the reason this leaf is worth doing before
   more sessions are written.
5. **`list` reports what it cannot read instead of dropping it.** Its entries carry the outcome, so
   an unreadable session appears in the store's own listing. **A store that distinguishes four
   outcomes on `load` and hides two of them from the surface a person browses has moved the defect
   rather than removed it** — and the difference a user experiences is between _my session vanished_
   and _my session needs a different build_.
6. **`listResumableSessionSummaries` still returns only resumable sessions** — that is what its name
   promises, and an unreadable session is genuinely not resumable. What changes is that it no longer
   _silently_ drops the others: the unreadable ids are reported alongside, so a surface can show them
   rather than having no way to know they exist.
7. **Replay fallback runs only for `missing`.** `WorkspaceProjectSessionStore.load` currently falls
   through to the replay log whenever the parse fails; after this it falls through only when there is
   no file. A damaged snapshot reports `corrupt` instead of being quietly replaced by a partial
   reconstruction.

**The accepted cost, stated where a reviewer meets it rather than in a footnote.** Every session file
written before this change has no version field and will load as `unsupported`. **A beta user's
in-progress session does not resume across this change.** That is the owner's ruling, made with the
cost visible, and it is the rule's stated position (`code-quality.md:58-59`) rather than an exception
to it. What the user sees is the point of item 5: not a session that vanished, and not a session that
silently came back empty, but a session this build cannot read.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — four packages plus `apps/`, enumerated in Affected Scope
      with the nine call sites; JSONL replay (issue #2098) excluded with its owner named.
- [x] Sibling scan 완료 — both port implementations read before designing (`NodeSessionStore`,
      `WorkspaceProjectSessionStore`), plus the three read-modify-write consumers and the summary
      projection. The second implementation is why this leaf cannot live in one package, and finding
      it changed the design rather than only the file list.
- [x] 대안 최소 2개 검토 완료 — four alternatives with pro/con; D is rejected on an explicit owner
      ruling rather than on preference.
- [x] 결정 근거 문서화 완료 — Decision names the deciding fact (the collapse is destructive, not just
      uninformative) and seven shape decisions with their reasons.
- [x] New-surface placement — **N/A: no new package, app, or presentation surface.** An existing port
      changes signature and an existing outcome vocabulary is reused.

## Fallback & Degradation Declaration

None — and this leaf **removes** two.

`session-store.ts:93`'s `// allow-fallback: corrupt session file is unrecoverable; treat as missing`
and `workspace-session-store.ts`'s `// allow-fallback: corrupt session state is unrecoverable; the
append-only log may recover it` are both deleted. The second is the one the acceptance criteria name:
replay may run for `missing`, never for `corrupt`.

No new sanctioned fallback is introduced. A read-modify-write consumer that meets a non-`valid` load
refuses to write; it does not degrade to writing a fresh record.

## Solution

**`packages/agent-interface-transport/src/session-contracts.ts`** — the outcome and the port:

```ts
export type TSessionLoadOutcome =
  | { readonly status: 'valid'; readonly record: IInteractiveSessionRecord }
  | { readonly status: 'missing' }
  | { readonly status: 'corrupt'; readonly issues: readonly ISessionRecordDecodeIssue[] }
  | { readonly status: 'unsupported'; readonly schemaVersion: number | undefined };

export interface ISessionListEntry {
  readonly id: string;
  readonly outcome: TSessionLoadOutcome;
}

export interface IInteractiveSessionStore {
  save(session: IInteractiveSessionRecord): void;
  load(id: string): TSessionLoadOutcome;
  list(): readonly ISessionListEntry[];
  delete(id: string): void;
  getFilePath?(id: string): string;
}
```

`ISessionRecordDecodeIssue` is the decoder's, re-exported from the codec — the port names the type,
the codec owns it.

**Both stores** decode through `decodeVersionedInteractiveSessionRecord` and write
`{ schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION, record }`.

**The consumers**, one line each in most cases: `if (!record)` becomes a match on `outcome.status`,
and the three read-modify-write sites gain an explicit refusal on `corrupt` / `unsupported`.

## Affected Files

| File                                                                          | Change                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------- |
| `packages/agent-interface-transport/src/session-contracts.ts`                 | outcome + list-entry types; port signature   |
| `packages/agent-interface-transport/src/index.ts`, `docs/SPEC.md`             | exports and contract documentation           |
| `packages/agent-session/src/session-store.ts`                                 | envelope write, decoded read, outcome return |
| `packages/agent-session/src/session-history-ops.ts`                           | refuse to overwrite a non-`valid` record     |
| `packages/agent-session/docs/SPEC.md`                                         | store contract                               |
| `packages/agent-framework/src/interactive/workspace-session-store.ts`         | same, plus the replay gate                   |
| `packages/agent-framework/src/interactive/interactive-session-restore.ts`     | report instead of returning an empty session |
| `packages/agent-framework/src/interactive/interactive-session-persistence.ts` | refuse to overwrite                          |
| `packages/agent-framework/src/interactive/interactive-session.ts`             | `setName` reports instead of no-op           |
| `packages/agent-framework/src/interactive/session-persistence.ts`             | summary projection reports unreadable ids    |
| `packages/agent-framework/src/testing/scripted-session-harness.ts`            | outcome match                                |
| `packages/agent-framework/docs/SPEC.md`                                       | store + resume contract                      |
| `apps/agent-server/src/routes/handlers/playground-session-create.ts`          | outcome match                                |
| `packages/agent-session/examples/…`, `packages/agent-transport/examples/…`    | outcome match                                |
| tests in `agent-session`, `agent-framework`, `agent-cli`                      | four-outcome coverage                        |

## Completion Criteria

- [x] TC-01: `NodeSessionStore.load` returns `status: 'missing'` for a session id with no file, and
      the replay fallback in `WorkspaceProjectSessionStore` runs for that case and only that case.
- [x] TC-02: A truncated session file loads as `status: 'corrupt'` carrying at least one issue whose
      `path` names a field — not `missing`, and not an empty record.
- [x] TC-03: A file written by an earlier build (a bare record, no envelope) loads as
      `status: 'unsupported'` with `schemaVersion: undefined`.
- [x] TC-04: A well-formed session round-trips: `save` then `load` returns `status: 'valid'` with a
      deep-equal record and revived `Date` timestamps.
- [x] TC-05: `persistSession` **does not write** when the existing record loads as `corrupt` or
      `unsupported`; the file on disk is byte-identical after the attempt.
- [x] TC-06: `loadSessionRecord` on a corrupt session does not return the fifteen-empty-member
      record; the caller can tell a damaged session from a new one.
- [x] TC-07: `setName` on an unreadable session does not silently succeed.
- [x] TC-08: `list()` includes an entry for an unreadable file, carrying its outcome, rather than
      omitting it.
- [x] TC-09: `listResumableSessionSummaries` still returns only `valid` sessions, and the unreadable
      ids are reported rather than dropped.
- [x] TC-10: The persisted file contains `{ "schemaVersion": 1, "record": { … } }` — asserted against
      the bytes on disk, not against the loaded value.
- [x] TC-11: `pnpm build` then `pnpm -w typecheck` pass — all nine call sites migrated, verified by
      the compiler on a freshly built `dist/`.
- [x] TC-12: `node scripts/harness/run-all-scans.mjs` passes, including `no-fallback` with both
      `allow-fallback` markers removed rather than relocated.

## Test Plan

| TC-ID | Test Type          | Tool / Approach                                                                     | Notes                                                                                              |
| ----- | ------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| TC-01 | Unit               | vitest — `NodeSessionStore` on an empty temp dir; framework store with a replay log | The replay gate is asserted by a paired case: missing runs it, corrupt does not                    |
| TC-02 | Unit               | vitest — write a valid file, truncate the bytes, load                               | Truncation rather than a hand-written broken literal, so the input is what a crash actually leaves |
| TC-03 | Unit               | vitest — write a BARE record (pre-envelope shape) directly, then load               | This is the every-beta-user case, so it is a first-class test                                      |
| TC-04 | Unit               | vitest — save/load round trip of a maximal record                                   |                                                                                                    |
| TC-05 | Unit (destructive) | vitest — corrupt the file, call `persistSession`, compare file bytes before/after   | Byte comparison, because "it did not throw" is not "it did not write"                              |
| TC-06 | Unit               | vitest — `loadSessionRecord` against a corrupt store                                |                                                                                                    |
| TC-07 | Unit               | vitest — `setName` against a corrupt store                                          |                                                                                                    |
| TC-08 | Unit               | vitest — one valid and one corrupt file in the same directory                       | Asserts the corrupt one is PRESENT in the listing                                                  |
| TC-09 | Unit               | vitest — same fixture, through the summary projection                               |                                                                                                    |
| TC-10 | Unit (bytes)       | vitest — read the written file with `readFileSync` and parse                        | Asserts the envelope on disk, which is the format change itself                                    |
| TC-11 | Build / typecheck  | `pnpm build` then `pnpm -w typecheck`                                               | Build FIRST — a stale `dist/` reports phantom cross-package errors                                 |
| TC-12 | Scan               | `node scripts/harness/run-all-scans.mjs`                                            |                                                                                                    |

## User Execution Test Scenarios

Not applicable is **not** claimed. This leaf changes what a user sees on their first resume after it
lands, and that user is every existing beta user — the pre-envelope file is the scenario, not an edge
of it.

### UES-01 — a session from an older build reports itself instead of vanishing or coming back empty

- **Agent-executability:** `agent-executable`.
- **Prerequisite:** `pnpm --filter @robota-sdk/agent-session build`.
- **Setup:** write a BARE record (the pre-envelope shape this build no longer produces) into a temp
  session directory, exactly as an earlier build would have left it.
- **Exact command:**

  ```bash
  node --input-type=module -e "
  import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import path from 'node:path';
  import { NodeSessionStore } from './packages/agent-session/dist/node/index.js';
  const dir = mkdtempSync(path.join(tmpdir(), 'ues-'));
  const bare = { id: 's1', cwd: '/w', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', messages: [] };
  writeFileSync(path.join(dir, 's1.json'), JSON.stringify(bare, null, 2), 'utf-8');
  const store = new NodeSessionStore(dir);
  console.log('1', store.load('s1').status);
  const entries = store.list();
  console.log('2', entries.length, entries[0]?.outcome.status);
  rmSync(dir, { recursive: true, force: true });
  "
  ```

- **Expected observable result** — exit code 0 and exactly these two lines:

  ```
  1 unsupported
  2 1 unsupported
  ```

  Line 1 is the load reporting the pre-envelope file as written by a build this one does not read —
  not `missing`, and not an empty record. Line 2 is the listing containing **one** entry, and that
  entry being the unreadable session. Before this leaf the same setup yields `undefined` from `load`
  and an **empty** listing: the session is invisible, which is the difference between "my session
  needs a different build" and "my session vanished".

- **Cleanup:** the temp directory is removed by the scenario.
- **Evidence field:** recorded in the Evidence Log under `[DONE-GATE-STAGE-2]`.

## Tasks

- [x] TRANS-007 — done — `.agents/tasks/completed/TRANS-007-store-loads-say-which-of-the-four-things-happened.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block; `status: draft`; `type: DATA` (in the 11-prefix list); `tags` present.
- Problem — five symptoms, each cited to file and line, and each verified by reading the code rather
  than inferred from the issue text. Symptom 2 (the next save overwrites a corrupt file) and Symptom 3
  (a rename that silently does nothing) are not in issue #2096's text at all; they were found by
  reading the three read-modify-write consumers of `load`.
- Problem — reproduction condition: a single concrete command (`head -c 200`, resume, type, look at
  the file) that exercises all five.
- No "TBD"/"TODO"/vague language outside the Tasks placeholder the template requires.
- Prior Art Research: three documentation citations, each a system that keeps absence and corruption
  apart — RFC 9110 §15.5.5/§15.6.1, `git fsck`, and `SQLITE_CORRUPT` with SQLite's How-To-Corrupt
  guidance. The third is load-bearing rather than decorative: it names the write-after-bad-read as the
  danger, which is this leaf's Symptom 2. Absence of a reference for the narrower resume-UX question
  is stated explicitly. `scan-spec-research.mjs` — passed.
- Architecture Review Checklist: all 4 `[x]`. Sibling scan `[x]` with evidence — BOTH port
  implementations were read before designing, and finding the second one
  (`WorkspaceProjectSessionStore`, which owns the replay fallback the acceptance criteria name)
  changed the design rather than only the file list. New-surface placement `N/A` with reason.
- Alternatives Considered: 4 with pro/con. D is rejected on an explicit owner ruling quoted verbatim
  with its rule citation, not on preference.
- Completion Criteria: 12, all `TC-N` prefixed (`grep -c` = 12), each a command or observable form.
  TC-05 and TC-10 are deliberately byte-level: "it did not throw" is not "it did not write", and "the
  loaded value looks right" is not "the envelope is on disk".
- Test Plan: 12 rows matching one-to-one; every row has a non-empty type and tool; none is "manual".
- User Execution Test Scenarios: present, not-applicable NOT claimed, and the scenario is the
  pre-envelope file — the case every existing beta user meets on their first resume — rather than a
  synthetic edge.
- Structure: `## Tasks` with placeholder; `## Evidence Log` present and empty before this entry; no
  `## Status` or `## Classification` in the body.
- `check-spec-doc-frontmatter.mjs` — passed. `pnpm exec prettier --check` — passed. The formatting
  check is run HERE rather than after a push, because TRANS-006 lost a CI round to a code-span line
  wrap `lint-staged` never saw: it formats staged files, and a script wrote that document after the
  stage.

**Recorded by:** this session, judged against the gate catalogue's GATE-WRITE criteria directly. The
`backlog-gate-guard` subagent was not dispatched, because this session operates under a user
instruction not to invoke the Agent tool.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

**Prior gate:** GATE-WRITE shows PASS above; input status `review-ready` in `.agents/spec-docs/backlog/`.

**(1) The delegation, verbatim.** The owner's session-opening instruction to the orchestrating session:

> 지금부터 깃헙 이슈에 등록된 것들을 처리할 것인데, 이슈들은 순서를 잘 맞춰서 처리해야함. 그렇기 때문에
> 너에게 오케스트레이션 권한을 줄테니 다른 세션들과 의사소통 하면서 이슈들을 나눠서 처리해줘.

and, on the GATE-APPROVAL question put to them explicitly, the owner SELECTED the option
`위임 선언 — 이슈 처리 전권`:

> 「근거가 타당하면 스스로 승인하고 진행하라」는 취지의 표준 위임을 지금 선언해 주시면, 각 spec의
> Evidence Log에 그 문장을 그대로 인용하고 + 근거 조건 충족을 입증하고 + 해당 항목이 위임 범위 안임을
> 보여서 GATE-APPROVAL을 통과시킵니다.

**Provenance, stated rather than smoothed over:** relayed by the orchestrating session, not typed into
this conversation; the owner selected an offered option rather than composing a sentence. A peer
session cannot grant approval on the owner's behalf and this entry does not claim it did.

**(2) The evidence condition is satisfied for THIS item — and this leaf has a second, stronger
warrant.** Beyond the standing delegation, **the owner ruled directly on this issue's central
question** while TRANS-006 was merging, verbatim on
[issue #2096](https://github.com/woojubb/robota/issues/2096):

> 2096는 그게 필요하면 넣으세요. 우리는 구버전 호환이라는게 없다고 규칙에 적혀있어요. 레거시는
> 고려하지 마세요. 아직 출시 전입니다.

That is a direct ruling on the format change and on refusing a compatibility branch, which is
alternative D. So the one decision in this leaf that could have been called externally visible is not
being made under the delegation at all — it was made by the owner, with the cost stated.

The remaining reasoning meets the 근거 condition:

- Five symptoms verified against the code, two of them (the destructive save, the silent rename)
  absent from the issue text and found by reading the consumers.
- The design is chosen against the failure mode rather than the symptom: alternative B keeps every
  call site working and leaves the destructive path unchanged, because the consumers that destroy
  data are precisely the ones not trying to diagnose anything.
- Prior art constrains rather than decorates — SQLite's guidance names the write-after-bad-read as
  the danger, which is Symptom 2.
- The second port implementation was found in the first pass and reported before any code was
  written, because it moves the leaf across a package boundary.

**(3) The item sits inside the delegated class.** Against the four exclusions:

- _Product direction / user-facing scope_ — the one user-visible decision (existing sessions do not
  resume) is the owner's own ruling, quoted above, not this session's.
- _A published or externally visible contract_ — **yes, and deliberately.** The port signature changes
  and the persisted format changes. Both are named by issue #2096's own acceptance criteria, both are
  on a prerelease package, and the owner has ruled on the format half explicitly. The orchestrating
  session confirmed the port half is specified by the issue rather than new scope, and declined to
  re-ask the owner what they had just decided.
- _Business / legal / strategic judgement_ — none.
- _A practice this repository has never used before_ — none; the outcome vocabulary and the envelope
  both already exist, from issue #2081 and issue #2097.
- _Repository-wide policy files_ — untouched.

**Independent architecture validation (conditional):** N/A — no new package, app or interface surface.

**No Architecture Review or frontmatter `type`/`tags` change is made after this entry.**

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-23

**Status upgrade:** approved → in-progress

**Prior gate:** GATE-APPROVAL shows PASS above; input status `approved`.

- Task file exists: `.agents/tasks/TRANS-007-store-loads-say-which-of-the-four-things-happened.md`.
- ID provenance: the orchestrating session assigned `TRANS-007` from its ledger. `--dry-run` was run
  first and printed `TRANS-007` (1464 claimed ids — 888 records, 1453 citations, 88 issue titles),
  agreeing with the assignment, so running the allocator for real claimed the number already chosen
  rather than a different one. `.agents/tasks/README.md` requires the ID and the record in ONE
  operation; the dry-run satisfies the ledger without reopening the read-then-write window.
- Task file path is recorded in this document's `## Tasks` section.
- Task correspondence: `## Plan` carries one entry per TC-N, TC-01 through TC-12.
- Test Plan section: present, ~1,400 characters, naming both test locations, both runner commands,
  and — the part worth having — WHY two of the cases are written the hard way. TC-05 compares file
  bytes because the defect is a write, and TC-10 reads the file because asserting a round trip proves
  only that the codec agrees with itself.

### [GATE-VERIFY] — ✅ PASS | 2026-08-23

**Prior gate:** GATE-IMPLEMENT shows PASS above; input status `in-progress` in `active/`.

- Task file: 12 of 12 `[x]`, none blocked or pending.
- Build: `pnpm build` — whole workspace, clean. Typecheck: `pnpm -w typecheck` — clean.
- Tests, whole-package suites rather than the new files alone: `agent-session` 47 files / 345,
  `agent-framework` 187 / 1466 (+ the new routing suite at 15), `agent-cli` 54 / 423,
  `agent-transport-tui` 74 / 576. All passing.
- Scans: `node scripts/harness/run-all-scans.mjs` — **141 passed, 2 skipped, 0 failed**. Two ratchets
  were re-frozen IN this change rather than left unlocked: `no-fallback` (the `silent-catch` in
  `session-store.ts` went 1 → 0) and `file-size` (`session-contracts.ts` shrank when the port moved
  out). An unlocked gain is a licence to grow back.

**Three defects found in this leaf's OWN implementation, each by a mechanism rather than by
re-reading:**

1. **The rename fix reintroduced the silence it removed.** `setName` reported an unreadable record by
   throwing — from inside a pre-existing `try { … } catch { /* Session not initialized yet */ }`. The
   report was swallowed by a catch meant for something else. Found because `file-size` refused the
   growth and forced the logic into its own module, where the two things that catch was covering
   became visible. The rename now lives in `interactive-session-rename.ts`; obtaining the session id
   may fail before initialisation and is handled, and the store outcome may not be swallowed.
   TC-07 asserts the failure ESCAPES, which is the claim — it did not exist before this.
2. **Two of three `valid`-outcome producers were unchecked.** The decode guard was written at the
   file-read path; `WorkspaceProjectSessionStore` constructs `valid` in two other places, both from
   the replay log, which casts its way to the contract. Enumerating the sink is not the same as
   covering every path that reaches it. The check moved to where the value is MADE — one producer,
   `asValidatedOutcome`, which nothing can bypass.
3. **The port outgrew its file.** `session-contracts.ts` passed its size ratchet, so the port, its
   outcome union, its listing entry and the decode-issue shape moved to `session-store-contracts.ts`.
   They are one subject; the split is better placement, not only a smaller file.

**Mutation testing, with the applied-check on every round.** Three mutants killed — the write-path
refusal (2 of 13 red), the replay gate (4 of 8 red), and the replay producer's decode. Each mutation
asserted the mutated text was present, or the original absent, in the file **before** the result was
read, because an unapplied edit is indistinguishable from a surviving mutant and fails in the
reassuring direction.

**And two tests that proved nothing, found only by that discipline.** The first version of the
replay-producer test saved a snapshot and loaded it — the snapshot path answered, so the replay path
was never reached and the case passed with the guard reversed. The second asserted a revived `Date`
on a replayed session, which the reconstruction already builds, so the property held either way. Both
SURVIVED the mutation. The property that actually separates a decoded replay from a cast one is
whether an invalid reconstruction can present itself as resumable; that assertion kills the mutant.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-23

UES-01 is fully written and is the case every existing beta user meets on their first resume after
this lands, rather than an edge of it: agent-executability decision, prerequisite build, the exact
command, the expected observable as two literal lines with what each proves, cleanup, evidence field.
Executability was established by running the command before this entry was written.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-23

UES-01 executed against `packages/agent-session/dist/node/index.js` — the built artifact, not source.

Observed — exit code 0, identical to the expectation authored before the run:

```
1 unsupported
2 1 unsupported
```

Line 1: a pre-envelope session file reports as written by a build this one does not read. Line 2: it
is PRESENT in the listing, as the one entry, carrying that outcome. Before this leaf the same setup
yields `undefined` and an empty listing — the session is invisible, and "needs a different build" is
indistinguishable from "gone".

**Durable artifacts:** `packages/agent-session/src/__tests__/session-store-load-outcomes.test.ts`,
`packages/agent-framework/src/interactive/__tests__/session-load-routing.test.ts`,
`packages/agent-interface-transport/src/session-store-contracts.ts`,
`packages/agent-framework/src/interactive/interactive-session-rename.ts`.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-23

**Status upgrade:** verifying → done

- **TC-01** `missing` is its own outcome and gates the replay fallback —
  `session-store-load-outcomes.test.ts > TC-01 / TC-04`, `session-load-routing.test.ts > TC-01`.
- **TC-02** a truncated file is `corrupt` with a located issue — `> TC-02` (truncates a previously
  valid file rather than hand-writing a broken literal, so the input is what a crash leaves).
- **TC-03** a pre-envelope bare record is `unsupported` — `> TC-03`, both stores.
- **TC-04** a well-formed session round-trips with revived `Date`s — `> TC-01 / TC-04`.
- **TC-05** the write path leaves an unreadable file **byte-identical** — asserted on file bytes in
  `agent-session`, and on the framework path mid read-modify-write with a positive control, because
  a refusal test passes against a `persistSession` that never writes at all.
- **TC-06** resume reports why a session came back empty — `session-load-routing.test.ts > TC-06`.
- **TC-07** a rename that cannot be written down throws rather than silently succeeding — `> TC-07`,
  with the `missing` and readable cases as controls.
- **TC-08** `list()` includes the unreadable entry — both stores.
- **TC-09** the resumable projection returns only `valid`, and `listUnreadableSessions` reports the
  rest — `> TC-08 / TC-09`.
- **TC-10** the bytes on disk are `{ "schemaVersion": 1, "record": … }`, read with `readFileSync` and
  parsed — asserting a round trip would prove only that the codec agrees with itself.
- **TC-11** `pnpm build` then `pnpm -w typecheck`, in that order, both clean.
- **TC-12** `run-all-scans` 141 passed / 0 failed, with both ratchets re-frozen in this change.

**Test Plan coverage:** TC-01…TC-10 automated at the `describe` names above; TC-11 and TC-12 are
build/scan rows naming their command and observed result, with no vitest wrapper — the scan IS the
automated check and a wrapper would assert the scan's result rather than the property.

**Summary.** 12 of 12 criteria met and evidenced. 2,810 tests green across the four affected
packages. The leaf ends a documented contract property and says what replaces it. Three defects in
its own implementation were caught by the harness and by mutation rather than by re-reading, and two
tests that exercised nothing were found the same way.
