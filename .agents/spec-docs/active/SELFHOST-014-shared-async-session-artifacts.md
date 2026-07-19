---
status: in-progress
type: DATA
tags: [session-artifact, sharing, resume, persistence, agent-session, selfhost]
---

# SELFHOST-014 (DESIGN): asynchronous shareable / resumable session artifacts

## Problem

Promotes backlog [SELFHOST-014](../../backlog/SELFHOST-014-shared-async-session-artifacts.md) toward
[VISION.md](../../../VISION.md) as a self-hosting differentiator. Concrete symptom: Robota can persist a session
locally (`SessionStore` → `~/.robota/sessions/{id}.json`, `packages/agent-session/src/session-store.ts`) and
resume it **on the same machine** (`--resume`/`--continue`/fork, via
`loadSessionRecord` in `packages/agent-framework/src/interactive/interactive-session-restore.ts`), and it can
**collaborate live** over a P2P channel (REMOTE-001 — WebRTC pairing + co-drive). But there is **no asynchronous,
durable, shareable form of a thread**: an operator cannot hand a colleague (or their own second surface) a
resumable artifact of a session, to open and continue later without both parties being online at once.

The two existing mechanisms leave this exact gap:

- **Local persistence is not shareable.** A session record is a JSON file under the operator's home dir, keyed by
  an internal UUID and resolvable only by the local store. There is no export-to-portable-artifact / import-into-
  another-store path, so a thread cannot leave the machine that produced it.
- **REMOTE-001 is live, not durable.** REMOTE-001 (the `agent-remote-pairing` / `agent-transport-webrtc` /
  `agent-transport-protocol` family) is a **live wire**: it pairs two peers and streams a session between them in
  real time. Its "resume" — `SessionResumeBridge`
  (`packages/agent-transport-protocol/src/session-resume-bridge.ts`, REMOTE-013 E4) — resumes across a **data-channel
  drop within one live session** (monotonic `seq`/`ack`, buffered tail replay). It requires both peers online and
  produces no artifact you can put down and pick up hours or days later on a different surface.

Every competitive coding agent ships an async shareable/resumable thread (see Prior Art). Robota has the live form
and the local form, but not the async durable one.

## Prior Art Research

From product documentation:

- **Amp — persistent, synced Threads** ([ampcode.com/manual](https://ampcode.com/manual)): a thread is a
  first-class durable object synced to the cloud and **resumable across devices and shareable with teammates** —
  the async counterpart to a live pairing.
- **GitHub Copilot cloud agent — session logs + draft-PR artifact**
  ([docs.github.com/copilot cloud-agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)):
  an agent run is persisted as a durable session log plus a draft-PR artifact that a human opens and continues
  **later, asynchronously**, from a different surface than the one that produced it.
- **Devin — shared artifacts (PR + session)** ([deployhq.com/guides/devin](https://www.deployhq.com/guides/devin)):
  a run yields shared artifacts (a PR description and a shareable session) that a human resumes/reviews out of band.

**Common shape:** a session is a durable, transportable object; sharing = export/hand-off of that object; resume =
importing it into another surface and continuing — with **no requirement that the producer is still online**. This
is orthogonal to a live channel: the durable artifact and the live wire are complements.

**Robota constraint / delta:**

1. **Reuse the record, do not invent a format.** Robota already has a persisted, resumable session record —
   `IInteractiveSessionRecord` (owned by `agent-interface-transport`,
   `packages/agent-interface-transport/src/session-contracts.ts`) and its storage-neutral on-disk form
   `ISessionRecord` (owned by `agent-session`, `packages/agent-session/src/session-store.ts`), which align
   field-for-field (both carry `id/cwd/createdAt/updatedAt/messages/history/systemPrompt/toolSchemas/background*/
memory*/contextReferences/sandboxSnapshotId/goal`). The shareable artifact MUST be an export/import envelope over
   **this** record — not a parallel "shareable thread" schema that would drift from the resume path.
2. **Complement REMOTE-001, do not duplicate its live channel.** SELFHOST-014 is the ASYNC/durable form: export a
   thread to a portable artifact, import + resume it later / on a second surface, with both peers possibly offline.
   It does not add a second live transport.
3. **Neutrality boundary.** The neutral serialize/deserialize primitive is storage-neutral and belongs in a
   library; the **sharing policy** (who may open it, link/upload scheme, cloud sync, redaction of secrets) is a
   product concern and belongs in the app surfaces, never in `packages/`.

## Architecture Review

### Affected Scope

- **`agent-session`** — owns the neutral **export/import artifact envelope** over its storage-neutral `ISessionRecord`,
  in a **new sibling module `packages/agent-session/src/session-artifact.ts`** (SRP: record-**transport** vs the
  file-backed persistence in `session-store.ts` — the envelope is not folded into `SessionStore`), **mirroring the
  existing `SessionStore.save`/`load` round-trip** (temp-file + atomic rename → JSON on disk; `JSON.parse` → record).
  The envelope exposes **two operations that are specified separately and MUST NOT be conflated**:
  1. **Round-trip serialize (fidelity, local — no redaction).** `serialize(record)` with no transform is the pure,
     full-fidelity form: `deserialize(serialize(record))` deep-equals the record for local resume/backup. This is the
     round-trip floor (TC-01/TC-03) and carries **every** field verbatim.
  2. **Export-for-share (app-supplied redaction applied).** `serialize(record, options?)` accepts a **policy-free**
     `redact: (record) => record` transform the caller supplies; the envelope applies it to the record before
     writing bytes but **defines no field policy of its own**. The library never selects which fields to drop and
     never forces a transform into the round-trip path — the no-transform form (op 1) stays full-fidelity.

  Both forms produce a `deserialize(bytes) → record` pair with a **schema-version header** (so an artifact produced by
  one build is identifiably importable by another). This is a pure, policy-free mechanism — it carries no notion of
  "who can see it," no links, no cloud, no auth, and **no field-redaction policy**. It fits `agent-session`'s SPEC
  boundary, which already declares it "owns the storage-neutral persistence primitive … opaque payloads with no typed
  resumable-session shape." Because the storage-neutral record is byte-identical to the serialized typed
  `IInteractiveSessionRecord`, a **non-redacted** exported artifact is exactly what the framework already reads back on
  resume.

- **`agent-session` (reusable opt-in scrub, SSOT — reuse, don't duplicate).** The package **already** has recursive,
  mechanism-level secret redaction in `FileSessionLogger` (`docs/SPEC.md:252`: keys `apiKey`/`authorization`/
  `accessToken`/`refreshToken`/`secret`/`password`/`xApiKey` → `[REDACTED]` before persistence). Today that scrub is a
  **private, logging-coupled** function in `session-logger.ts` (`SENSITIVE_KEY_PATTERN` + `normalizeLogValue`), NOT
  exported — so "reuse" requires **EXTRACTING the pure recursive secret-key walk into a shared utility (SSOT) and
  REFACTORING `FileSessionLogger` to consume it** (deleting its private copy), leaving exactly one implementation.
  SELFHOST-014 then **composes** that extracted opt-in utility into its `redact` transform on the share path — it is
  NOT re-implemented, and it is NEVER forced into the round-trip (local resume needs full fidelity). The utility is a
  pure recursive secret-key scrub only; the **trust-boundary FIELD policy**
  (which of `cwd`/`sandboxSnapshotId`/`contextReferences` to strip, target audience) stays **app-owned**, not baked
  into the library.
- **`agent-framework` (resume path, reused unchanged)** — the resume flow already exists:
  `buildInteractiveSessionRecord`
  (`packages/agent-framework/src/interactive/interactive-session-persistence.ts`) writes the record and
  `loadSessionRecord` (`.../interactive-session-restore.ts`) re-injects messages/history/goal/background snapshots
  into a session (CLI-073 already resumes a record into a **new** session id — the fork case). Importing an artifact
  = `deserialize` → `store.save(record)` into the target store → the **existing** resume path runs verbatim. No new
  resume machinery; SELFHOST-014 adds the transport of the record between stores, not a second way to rehydrate one.
- **`apps/agent-app` + `apps/agent-web` (sharing UI + policy)** — the share/import UI and **all policy** live HERE:
  producing a shareable link/file, choosing a destination (download, cloud upload, sync), access control, and the
  **redaction FIELD policy** — which surface-sensitive fields the record carries (absolute `cwd`, `sandboxSnapshotId`,
  memory/`contextReferences`) to strip, and for which audience — before it crosses a trust boundary. The app builds its
  `redact: (record) => record` transform HERE and passes it to `serialize(record, { redact })` on the share path,
  **composing** the library's reusable opt-in secret-scrub utility (the `FileSessionLogger` key-scrub, reused not
  re-implemented) for mechanism-level secret removal on top of its own field policy. These are product decisions; per
  the neutrality boundary the field policy and share mechanics must not enter `packages/`.
- **Boundary vs REMOTE-001 (stated, not duplicated).** REMOTE-001 = the **live** channel (pair two online peers,
  stream a session in real time; `SessionResumeBridge` recovers a dropped data channel _within_ a live session).
  SELFHOST-014 = the **async durable artifact** (export a thread to a portable object, import + resume later / on a
  second surface, no liveness requirement). They compose: you can export an artifact of a session you drove live, or
  start a live session from an imported artifact. SELFHOST-014 adds **no** transport, pairing, or wire protocol.

### Alternatives Considered

1. **Neutral export/import envelope over the existing `ISessionRecord` in `agent-session` (mirror
   `SessionStore.save`/`load`); resume reuses `agent-framework`'s existing `loadSessionRecord` unchanged; sharing UI +
   policy live in the app surfaces (CHOSEN).**
   - ✅ Reuses the proven record + resume path (round-trip already exercised by `SessionStore` and
     `loadSessionRecord`); zero schema drift; storage-neutral primitive stays in the library while product policy
     stays in apps (honours `agent-session`'s stated SPEC boundary + the neutrality rule); complements REMOTE-001
     without a second transport; an imported artifact resumes with full fidelity because it _is_ the record.
   - ❌ The envelope must carry a schema-version header and a forward-compat stance for records produced by older/newer
     builds (stated; a version guard is part of the completion criteria, not hidden).
2. **Invent a new, distinct "shareable thread" format (a compact/curated share schema) separate from the session
   record.**
   - ✅ Could tailor a smaller or prettier share payload independent of the resume record.
   - ❌ A parallel format duplicates the record and **drifts from the resume path** — a share payload that cannot
     rehydrate `messages/history/goal/background` is a strictly _weaker_ artifact (capability regression), and two
     schemas violate SSOT. It would also re-implement the round-trip `SessionStore` already provides. REJECTED
     (capability-preservation + SSOT).
3. **Put the sharing/sync logic (link generation, cloud upload, access policy) inside a package (e.g. `agent-session`
   or a new `agent-sharing` package).**
   - ✅ One implementation reused by both surfaces.
   - ❌ Bakes a **product/domain policy** (auth model, cloud provider, link scheme, redaction rules) into a neutral
     library — the exact violation `agent-session`'s SPEC boundary ("storage-neutral … opaque payloads") and the
     neutrality rule forbid. The neutral, reusable part is only serialize/deserialize, which alternative (1) already
     shares; the policy is genuinely per-surface. REJECTED (neutrality).
4. **"Share" by keeping a REMOTE-001 live session open (reuse the live channel as the sharing mechanism).**
   - ✅ No new code.
   - ❌ Not async and not durable — it requires both peers online simultaneously, produces no artifact to put down and
     pick up later, and cannot resume on a second surface after the producer has gone offline. It does not close the
     gap this spec exists for. REJECTED (does not meet the async/durable requirement).

### Decision

Adopt (1): a **neutral, policy-free export/import envelope over the storage-neutral `ISessionRecord` in
`agent-session`**, mirroring `SessionStore.save`/`load`, with a schema-version header; **resume reuses
`agent-framework`'s existing `loadSessionRecord` unchanged** (import = `deserialize` → `store.save` → the current
resume path); the **sharing UI + all policy (links, sync, access, redaction) live in `apps/agent-app` /
`apps/agent-web`**, never in `packages/`. SELFHOST-014 is the **async durable complement** to REMOTE-001's live
channel and adds no transport.

### Validated Recommendation

- **Reachability:** the envelope ships from `agent-session` beside `SessionStore` (already reachable by every
  surface that persists sessions); the resume path is the one `--resume`/fork already uses; the apps supply the share
  surface. The end-to-end path — export on surface A → hand off → import into surface B's store → resume — is
  reachable **without any library-side sharing-policy choice**. Verified against `SessionStore.save`/`load`
  (`session-store.ts`) and `buildInteractiveSessionRecord`/`loadSessionRecord`
  (`interactive-session-persistence.ts` / `interactive-session-restore.ts`).
- **Capability preservation:** because the artifact **is** the `ISessionRecord`/`IInteractiveSessionRecord` (not a
  reduced share schema), an imported artifact resumes with **full fidelity** — `messages`, `history`, `goal`,
  `background*`, `memory*`, `contextReferences`, `sandboxSnapshotId` — identical to a local `--resume`. No capability
  is dropped relative to local resume; the rejected "new share format" (alt 2) would have silently regressed this.
- **Adversarial (the one real gap this revision closes):** the main risk is a **trust-boundary leak** — the record
  **always** carries an absolute `cwd`, a `sandboxSnapshotId`, `contextReferences`, and possible secrets in
  `messages`, none of which should cross to another party unredacted — plus the temptation to sneak sharing policy
  into the library. A serialize primitive that only ever emits the full record **defaults-to-leak**. Mitigations, now
  made explicit and mechanical:
  1. **Opt-in redaction seam on the export path.** `serialize(record, { redact })` lets the app apply a policy-free
     transform before bytes are written (op 2 above), so the share path is redactable **without** the library owning
     any field policy; the no-transform round-trip (op 1) stays full-fidelity for local resume. The two operations are
     specified separately and never conflated (TC-01/TC-03 guard fidelity; TC-07 guards the redacted share path).
  2. **Reuse the existing scrub (SSOT).** The `FileSessionLogger` recursive secret-key scrub is exposed as a reusable
     opt-in utility the app composes into its `redact`; it is not re-implemented and never forced into the round-trip.
  3. **Mechanical neutrality floor (no longer "code review").** TC-05 is a `harness:scan` grep floor asserting the
     envelope module contains no link/cloud/access/redaction-**policy** tokens (neutrality is enforced, not reviewed);
     the schema-version header lets an importer reject/adapt an incompatible record rather than mis-resume it.
     Trust-boundary FIELD policy (which fields, which audience) is app-owned by design, not a library gap.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-session` (neutral export/import envelope over `ISessionRecord` in a **new sibling
      `session-artifact.ts`**, mirror `SessionStore.save`/`load`; opt-in `redact` seam + reusable `FileSessionLogger`
      scrub reused as SSOT); `agent-framework` resume path **reused unchanged** (`loadSessionRecord`); sharing UI +
      redaction FIELD policy in `apps/agent-app` / `apps/agent-web`. No new package, no new transport.
- [x] Sibling scan 완료 — mirrors the **`SessionStore` persistence precedent** (atomic JSON round-trip over
      `ISessionRecord`) and the **existing resume path** (`buildInteractiveSessionRecord` / `loadSessionRecord`); does NOT
      duplicate the **REMOTE-001 live channel** (`agent-remote-pairing` / `agent-transport-webrtc` /
      `SessionResumeBridge`), whose "resume" is intra-live-session channel recovery, not an async artifact.
- [x] 대안 최소 2개 — 4 considered (envelope-over-record CHOSEN; new-share-format REJECTED capability+SSOT;
      policy-in-a-package REJECTED neutrality; live-channel-as-sharing REJECTED not-async), each Pro+Con.
- [x] 결정 근거 — capability-preservation + SSOT force reusing the record; the neutrality rule + `agent-session`'s SPEC
      boundary force the split (neutral serialize in the library, sharing policy in the apps); the opt-in `redact` seam
      closes the defaults-to-leak trust-boundary gap while preserving the fidelity round-trip; neutrality/complement
      floors are mechanized (TC-05 grep floor + TC-06 deps scan); complements REMOTE-001's live form. GATE-APPROVAL:
      RE-REVIEW → REVISE applied (see Evidence Log 2026-07-17 iteration 1).

## Solution

A neutral **export/import envelope** in a new sibling module `packages/agent-session/src/session-artifact.ts`
(record-transport, distinct from the file-backed `session-store.ts`) over the storage-neutral `ISessionRecord`, with
a schema-version header, mirroring the existing `SessionStore.save`/`load` round-trip. The envelope specifies **two
non-conflated operations**: (1) **round-trip serialize** — `serialize(record)` with no transform is the pure,
full-fidelity local form where `deserialize(serialize(record))` deep-equals the record (fidelity floor, no
redaction); (2) **export-for-share** — `serialize(record, { redact })` applies a caller-supplied **policy-free**
`redact: (record) => record` transform before writing bytes, so an app can strip trust-boundary fields on the share
path without the library owning any field policy. The `FileSessionLogger` recursive secret-key scrub
(`docs/SPEC.md:252`) is **exposed as a reusable opt-in utility** (SSOT) the app composes into its `redact`; it is
never re-implemented and never forced into the round-trip. **Import** deserializes an artifact and `store.save`s the
record into the target store; **resume** is then the **existing** `loadSessionRecord` path (`--resume`/fork),
unchanged. The **sharing UI + all policy** (link/file production, destination/sync, access control, and the
**redaction field policy** — which of `cwd`/`sandboxSnapshotId`/`contextReferences` to strip, for which audience)
live in `apps/agent-app` / `apps/agent-web`. This is the **async durable complement** to REMOTE-001's live P2P
channel — no new transport, pairing, or wire protocol.

## Affected Files

| File                                                                      | Change                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-session/src/session-artifact.ts` (**new** sibling)        | neutral export/import envelope over `ISessionRecord` — `serialize(record, options?)` (op 1 round-trip / op 2 export-for-share via policy-free `redact`) + `deserialize` + schema-version header; mirrors `save`/`load`. **Not** folded into `session-store.ts` (SRP: transport vs file persistence) |
| `packages/agent-session/src/` (new shared scrub utility)                  | **EXTRACT** the pure recursive secret-key scrub (`SENSITIVE_KEY_PATTERN` + object/array walk) out of `session-logger.ts` into a shared pure utility (SSOT), exposed as an **opt-in** function an app composes into `redact`; never forced into the round-trip                                       |
| `packages/agent-session/src/session-logger.ts`                            | **REFACTOR** `FileSessionLogger` to CONSUME the extracted scrub utility (delete its private copy) so exactly ONE scrub implementation exists — this is what makes fix "reuse, don't duplicate" true (today the scrub is private + logging-coupled + not exported)                                   |
| `packages/agent-session/src/index.ts`                                     | export the artifact envelope primitive + the opt-in scrub utility                                                                                                                                                                                                                                   |
| `packages/agent-session/docs/SPEC.md`                                     | record the artifact primitive + the two operations + the reusable opt-in scrub under the storage-neutral persistence ownership (SSOT)                                                                                                                                                               |
| `packages/agent-framework/src/interactive/interactive-session-restore.ts` | resume path **reused as-is** — import = `deserialize` → `store.save` → existing `loadSessionRecord` (no new resume logic)                                                                                                                                                                           |
| `apps/agent-app` / `apps/agent-web`                                       | share/import UI + **all policy** (link/file, sync, access, redaction FIELD policy for `cwd`/`sandboxSnapshotId`/`contextReferences`); builds the `redact` transform + composes the opt-in scrub — never in `packages/`                                                                              |
| `scripts/harness/*` (guard floors — see TC-05/TC-06)                      | TC-05 grep floor (no link/cloud/access/redaction-policy tokens in `session-artifact.ts`); TC-06 dep-direction assertion (no edge from the artifact path to `agent-remote-pairing`/`agent-transport-webrtc`)                                                                                         |

## Completion Criteria

- [ ] TC-01: **round-trip serialize WITHOUT redaction is the fidelity floor** — `deserialize(serialize(record))`
      (no `redact` transform) deep-equals the original `ISessionRecord` for a record exercising every field
      (`messages`/`history`/`goal`/`background*`/`memory*`/`contextReferences`/`sandboxSnapshotId`). This is the
      pure local round-trip and is **distinct from the redacted share path** (TC-07) — the two are never conflated
      (unit test).
- [ ] TC-02: **schema-version guard** — an artifact with an unknown/incompatible schema version is rejected (or
      adapted) rather than silently mis-imported; a same-version artifact imports cleanly (unit test).
- [ ] TC-03: **imported artifact resumes** — importing an exported artifact into a target store and running the
      existing `loadSessionRecord` path rehydrates `messages`/`history`/`goal` identically to a local `--resume` (unit
      test on the resume path; no new resume machinery introduced).
- [ ] TC-04: **a shared artifact resumes on a second surface** — export from surface A's store, import into a
      **distinct** surface B's store (different `baseDir`), and resume there; the resumed session's messages/history/goal
      match the source with both stores independent (functional test).
- [ ] TC-05: **neutrality — sharing policy is NOT in `packages/` (mechanized grep floor)** — a `pnpm harness:scan`
      grep floor over `session-artifact.ts` asserts the envelope module contains no link/cloud/upload/access-control or
      redaction-**policy** tokens (it is pure serialize/deserialize + schema version + the app-supplied `redact` seam).
      This is a mechanical scan floor per enforcement-architecture, **not** a code-review promise.
- [ ] TC-06: **complements, does not duplicate, REMOTE-001 (mechanized deps scan)** — a `deps`-style dependency-
      direction scan asserts the artifact path (`session-artifact.ts` / `agent-session`) has **no** dependency edge to
      `agent-remote-pairing` or `agent-transport-webrtc`, so the export → import → resume path completes with no live
      channel (no pairing, no WebRTC/`SessionResumeBridge`) and both peers may be offline. Mechanical, not a design
      assertion.
- [ ] TC-07: **export-for-share WITH an app-supplied `redact` transform strips trust-boundary fields** —
      `serialize(record, { redact })` with a transform that drops `cwd`/`sandboxSnapshotId` and composes the opt-in
      secret-scrub produces an artifact whose deserialized record has those fields absent/redacted (named secret keys →
      `[REDACTED]`), while the same record serialized WITHOUT `redact` retains them (TC-01). Proves the seam is opt-in
      and the share path is redactable without any library-side field policy (unit test).
- [ ] TC-08: **a REDACTED share artifact still resumes on surface B (import-side rebinding of stripped required
      fields).** Because `redact` may strip the **required** `cwd` field (and other surface-bound fields), the export →
      hand-off → import → resume-on-B path must not silently fail: the **import/app layer on surface B rebinds the
      stripped required fields (supplies B's own `cwd`)** before invoking the existing resume path. Assign this
      rebinding responsibility to the app/import layer (the strip decision is app-owned per TC-07; the rebind is its
      symmetric counterpart — the library envelope neither strips nor rebinds field policy). Functional test:
      `redact(strip cwd) → import on B → rebind B's cwd → resume` succeeds and messages/history/goal match (the
      redaction seam and the resume contract are proven end-to-end, closing the seam TC-07 opened).

## Test Plan

| TC    | Verification                                                        | Type/Tool                                     |
| ----- | ------------------------------------------------------------------- | --------------------------------------------- |
| TC-01 | round-trip serialize (no redact) deep-equal (all fields)            | vitest unit (fidelity floor)                  |
| TC-02 | schema-version accept/reject                                        | vitest unit                                   |
| TC-03 | imported record resumes via existing path                           | vitest unit (resume path)                     |
| TC-04 | export A-store → import B-store → resume on B                       | functional test (two independent stores)      |
| TC-05 | no link/cloud/access/redaction-policy tokens in module              | `harness:scan` grep floor (mechanical)        |
| TC-06 | no dep edge → `agent-remote-pairing`/`-webrtc`                      | `deps` dependency-direction scan (mechanical) |
| TC-07 | share-export with `redact` strips `cwd`/`sandboxSnapshotId`/secrets | vitest unit (share path, distinct from TC-01) |
| TC-08 | redacted export → import → app rebinds `cwd` on B → resume          | functional test (redact/resume end-to-end)    |

## Tasks

P1 = the neutral envelope primitive in `agent-session` + the reusable opt-in scrub + guard floors + resume-path
reuse. App-surface sharing UI/policy is out of `packages/` (apps/).

- **P1** — [`.agents/tasks/SELFHOST-014-P1.md`](../../tasks/SELFHOST-014-P1.md) (GATE-IMPLEMENT; in progress).

## Evidence Log

- 2026-07-17 — **Draft authored.** Grounded in the actual persistence + resume code: `SessionStore.save`/`load`
  over `ISessionRecord` (`packages/agent-session/src/session-store.ts:23-187`), the typed `IInteractiveSessionRecord`
  contract (`packages/agent-interface-transport/src/session-contracts.ts:377-406`), and the existing resume path
  `buildInteractiveSessionRecord` / `loadSessionRecord`
  (`packages/agent-framework/src/interactive/interactive-session-persistence.ts` +
  `interactive-session-restore.ts`). **Mirror-an-analog verification:** confirmed the record is genuinely
  export/import round-trippable and resumable _today_ — `SessionStore` already round-trips it through JSON
  (`JSON.stringify` on `save`, `JSON.parse` on `load`), the storage-neutral `ISessionRecord` aligns field-for-field
  with the typed `IInteractiveSessionRecord`, and `loadSessionRecord` already re-injects `messages`/`history`/`goal`
  into a fresh session id (CLI-073 fork). REMOTE-001 boundary confirmed distinct: `SessionResumeBridge`
  (`packages/agent-transport-protocol/src/session-resume-bridge.ts`) resumes across a **data-channel drop within one
  live session**, not an async artifact. No session export/share feature exists in the repo today (grep confirmed the
  gap). **GATE-APPROVAL pending** (independent proposal-reviewer sign-off not yet run).
- 2026-07-17 — **GATE-APPROVAL re-review → REVISE, applied (iteration 1).** Design DIRECTION confirmed correct
  (envelope over the existing `ISessionRecord` in `agent-session`; resume reuses `loadSessionRecord` unchanged;
  sharing UI/policy in the apps; complements REMOTE-001 — all kept). One real gap: the **trust-boundary REDACTION
  seam** — a serialize primitive that only ever emits the full record defaults-to-leak, since the record always
  carries an absolute `cwd`, `sandboxSnapshotId`, `contextReferences`, and possible secrets in `messages`. Fixes
  applied: (1) **Opt-in redaction seam on the export path** — `serialize(record, options?)` takes a policy-free
  `redact: (record) => record`; the two operations are now specified separately and never conflated — "round-trip
  serialize (fidelity, local — no redaction)" vs "export-for-share (app-supplied redaction applied)" — preserving
  TC-01/TC-03 fidelity while closing the defaults-to-leak posture. (2) **Reuse, not duplicate, the scrub** — the
  existing `FileSessionLogger` recursive secret-key redaction (`docs/SPEC.md:252`) is exposed as a reusable **opt-in**
  utility (SSOT) the app composes into `redact`; the library never forces it into the round-trip and never owns the
  trust-boundary FIELD policy (which of `cwd`/`sandboxSnapshotId`/`contextReferences`, audience) — that stays
  app-owned. (3) **File placement pinned** — the envelope goes in a **new sibling `packages/agent-session/src/
session-artifact.ts`** (SRP: record-transport vs file-backed `session-store.ts`); the Affected-Files "(or a
  sibling …)" hedge is resolved to this decision. (4) **Guard TCs mechanized** per enforcement-architecture — TC-06
  is a `deps` dependency-direction assertion that the artifact path has no edge to `agent-remote-pairing`/
  `agent-transport-webrtc` (complements-not-duplicates-REMOTE-001, mechanically); TC-05 is a `harness:scan` grep floor
  asserting no link/cloud/access/redaction-**policy** tokens in the envelope module (neutrality), replacing the prior
  "code review + grep". (5) **New TCs** — TC-07 (share-export WITH `redact` strips `cwd`/`sandboxSnapshotId`/named
  secret fields) and TC-01 restated as the no-redaction fidelity floor, explicitly distinct from the share path.
  Affected Files / Completion Criteria / Test Plan / Architecture Review Checklist updated for consistency. Everything
  else (envelope over `ISessionRecord`, resume reuses `loadSessionRecord`, apps own sharing UI/policy, the 4
  correctness-grounded alternatives, complements REMOTE-001) unchanged.
- 2026-07-17 — **iteration 2: RE-REVIEW → REVISE, applied.** Re-reviewer confirmed all 5 iteration-1 fixes are
  present and mechanically sound (opt-in seam + two never-conflated ops; sibling `session-artifact.ts` SRP; TC-05
  grep floor + TC-06 deps scan are real mechanical floors; TC-07). Two doc-only seams the redaction fix itself opened,
  now closed: (1) **scrub SSOT extraction made explicit** — the scrub is today a PRIVATE, logging-coupled,
  un-exported function in `session-logger.ts`, so "reuse" required EXTRACTING the pure secret-key walk into a shared
  utility and REFACTORING `FileSessionLogger` to consume it (one copy); Affected Files now carries both the extract
  and the `session-logger.ts` refactor rows. (2) **Import-side rebinding of stripped required fields assigned** —
  `redact` may strip the REQUIRED `cwd`, so a redacted artifact would fail to resume unless the import/app layer on
  surface B rebinds it (supplies B's own `cwd`); added TC-08 (`redact → import → rebind cwd on B → resume`) and
  assigned the rebind responsibility to the app/import layer (symmetric counterpart of the app-owned strip decision;
  the library envelope neither strips nor rebinds field policy). Direction unchanged.
- 2026-07-17 — **iteration 3: RE-REVIEW → ENDORSE** (independent proposal-reviewer). Both seams verified closed
  against the code: the scrub is genuinely private/un-exported today (`SENSITIVE_KEY_PATTERN` `session-logger.ts:35`,
  `normalizeLogValue` `:103`; the barrel exports only `FileSessionLogger`/`SilentSessionLogger`), so the EXTRACT +
  REFACTOR-to-consume is required, not a no-op; `cwd: string` is a REQUIRED field (`session-store.ts:29`,
  `session-contracts.ts:380/412`), so redact-strips-required + app-rebind (TC-08) is a real, cleanly-assigned seam
  (library owns no field policy). Round-trip fidelity floor (TC-01), mechanical guards (TC-05 grep / TC-06 deps),
  sibling `session-artifact.ts` placement, and complements-REMOTE-001 all intact; no new defect. Reordered TC-08 to
  numeric order (the reviewer's only, cosmetic, nit). **GATE-APPROVAL PASSED.**

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-19

**Status upgrade:** approved → in-progress
Prior-gate precondition: GATE-APPROVAL recorded PASS (2026-07-17 iteration 3 — independent proposal-reviewer ENDORSE, "GATE-APPROVAL PASSED"); frontmatter `status: approved` in `todo/` matches the expected input stage.
Tasks file created: `.agents/tasks/SELFHOST-014-P1.md` exists.
Tasks file path recorded: referenced in `## Tasks` (P1 → `.agents/tasks/SELFHOST-014-P1.md`).
Tasks map to Completion Criteria: slices S1 (scrub SSOT + logger refactor), S2 (envelope — TC-01/02/07), S3 (resume + second-surface + guards + docs — TC-03/04/05/06/08) cover all of TC-01..TC-08 (≥1 task per TC-N).
Test Plan present: task file `## Test Plan` section enumerates TC-01..TC-08 + regression, well over the 50-char `test-plans` scan floor [AF-24].
