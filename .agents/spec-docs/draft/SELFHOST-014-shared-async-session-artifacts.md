---
status: draft
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

- **`agent-session`** — owns the neutral **export/import artifact envelope** over its storage-neutral `ISessionRecord`
  (`packages/agent-session/src/session-store.ts`), **mirroring the existing `SessionStore.save`/`load` round-trip**
  (temp-file + atomic rename → JSON on disk; `JSON.parse` → record). The envelope is a `serialize(record) → bytes`
  / `deserialize(bytes) → record` pair with a **schema-version header** (so an artifact produced by one build is
  identifiably importable by another). This is a pure, policy-free mechanism — it carries no notion of "who can see
  it," no links, no cloud, no auth. It fits `agent-session`'s SPEC boundary, which already declares it "owns the
  storage-neutral persistence primitive … opaque payloads with no typed resumable-session shape." Because the
  storage-neutral record is byte-identical to the serialized typed `IInteractiveSessionRecord`, an exported artifact
  is exactly what the framework already reads back on resume.
- **`agent-framework` (resume path, reused unchanged)** — the resume flow already exists:
  `buildInteractiveSessionRecord`
  (`packages/agent-framework/src/interactive/interactive-session-persistence.ts`) writes the record and
  `loadSessionRecord` (`.../interactive-session-restore.ts`) re-injects messages/history/goal/background snapshots
  into a session (CLI-073 already resumes a record into a **new** session id — the fork case). Importing an artifact
  = `deserialize` → `store.save(record)` into the target store → the **existing** resume path runs verbatim. No new
  resume machinery; SELFHOST-014 adds the transport of the record between stores, not a second way to rehydrate one.
- **`apps/agent-app` + `apps/agent-web` (sharing UI + policy)** — the share/import UI and **all policy** live HERE:
  producing a shareable link/file, choosing a destination (download, cloud upload, sync), access control, and
  **redaction** of surface-sensitive fields the record carries (absolute `cwd`, memory/context references) before it
  crosses a trust boundary. These are product decisions; per the neutrality boundary they must not enter `packages/`.
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
- **Adversarial:** the main risk is a **trust-boundary leak** — the record carries an absolute `cwd` and
  memory/context references, and `sandboxSnapshotId`, which should not cross to another party unredacted — plus the
  temptation to sneak sharing policy into the library. Mitigations: the neutral envelope stays strictly policy-free
  (a TC asserts no sharing policy / link / cloud logic in `packages/`); **redaction is an app-surface responsibility**
  performed before an artifact leaves a trust boundary; the schema-version header lets an importer reject/adapt an
  incompatible record rather than mis-resume it. Neutrality here rests on `agent-session`'s SPEC boundary + code
  review; whether a mechanical `packages/`-neutrality floor is warranted is left to task-authoring (noted, not
  claimed as already enforced).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-session` (neutral export/import envelope over `ISessionRecord`, mirror
      `SessionStore.save`/`load`); `agent-framework` resume path **reused unchanged** (`loadSessionRecord`); sharing UI +
      policy in `apps/agent-app` / `apps/agent-web`. No new package, no new transport.
- [x] Sibling scan 완료 — mirrors the **`SessionStore` persistence precedent** (atomic JSON round-trip over
      `ISessionRecord`) and the **existing resume path** (`buildInteractiveSessionRecord` / `loadSessionRecord`); does NOT
      duplicate the **REMOTE-001 live channel** (`agent-remote-pairing` / `agent-transport-webrtc` /
      `SessionResumeBridge`), whose "resume" is intra-live-session channel recovery, not an async artifact.
- [x] 대안 최소 2개 — 4 considered (envelope-over-record CHOSEN; new-share-format REJECTED capability+SSOT;
      policy-in-a-package REJECTED neutrality; live-channel-as-sharing REJECTED not-async), each Pro+Con.
- [x] 결정 근거 — capability-preservation + SSOT force reusing the record; the neutrality rule + `agent-session`'s SPEC
      boundary force the split (neutral serialize in the library, sharing policy in the apps); complements REMOTE-001's
      live form. GATE-APPROVAL pending.

## Solution

A neutral **export/import envelope** in `agent-session` over the storage-neutral `ISessionRecord`
(`serialize(record) → bytes` with a schema-version header / `deserialize(bytes) → record`), mirroring the existing
`SessionStore.save`/`load` round-trip. **Import** deserializes an artifact and `store.save`s the record into the
target store; **resume** is then the **existing** `loadSessionRecord` path (`--resume`/fork), unchanged. The
**sharing UI + all policy** (link/file production, destination/sync, access control, redaction of `cwd`/references)
live in `apps/agent-app` / `apps/agent-web`. This is the **async durable complement** to REMOTE-001's live P2P
channel — no new transport, pairing, or wire protocol.

## Affected Files

| File                                                                                    | Change                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/agent-session/src/session-store.ts` (or a sibling `session-artifact.ts`, new) | neutral export/import envelope over `ISessionRecord` (`serialize`/`deserialize` + schema-version header), mirror `save`/`load` |
| `packages/agent-session/src/index.ts`                                                   | export the artifact envelope primitive                                                                                         |
| `packages/agent-session/docs/SPEC.md`                                                   | record the artifact primitive under the storage-neutral persistence ownership (SSOT)                                           |
| `packages/agent-framework/src/interactive/interactive-session-restore.ts`               | resume path **reused as-is** — import = `deserialize` → `store.save` → existing `loadSessionRecord` (no new resume logic)      |
| `apps/agent-app` / `apps/agent-web`                                                     | share/import UI + **all policy** (link/file, sync, access, redaction of `cwd`/references) — never in `packages/`               |

## Completion Criteria

- [ ] TC-01: **export/import round-trip** — `deserialize(serialize(record))` deep-equals the original
      `ISessionRecord` for a record exercising every field (`messages`/`history`/`goal`/`background*`/`memory*`/
      `contextReferences`/`sandboxSnapshotId`) (unit test).
- [ ] TC-02: **schema-version guard** — an artifact with an unknown/incompatible schema version is rejected (or
      adapted) rather than silently mis-imported; a same-version artifact imports cleanly (unit test).
- [ ] TC-03: **imported artifact resumes** — importing an exported artifact into a target store and running the
      existing `loadSessionRecord` path rehydrates `messages`/`history`/`goal` identically to a local `--resume` (unit
      test on the resume path; no new resume machinery introduced).
- [ ] TC-04: **a shared artifact resumes on a second surface** — export from surface A's store, import into a
      **distinct** surface B's store (different `baseDir`), and resume there; the resumed session's messages/history/goal
      match the source with both stores independent (functional test).
- [ ] TC-05: **neutrality — sharing policy is NOT in `packages/`** — the library envelope contains no link scheme,
      cloud/upload, access-control, or redaction policy (it is pure serialize/deserialize + version); a code review /
      targeted grep confirms sharing policy lives only in the app surfaces.
- [ ] TC-06: **complements, does not duplicate, REMOTE-001** — the export → import → resume path completes with **no
      live channel** (no pairing, no WebRTC/`SessionResumeBridge`), i.e. both peers may be offline; the artifact path does
      not depend on `agent-remote-pairing` / `agent-transport-webrtc` (design assertion + a dependency check).

## Test Plan

| TC    | Verification                                  | Type/Tool                                |
| ----- | --------------------------------------------- | ---------------------------------------- |
| TC-01 | serialize/deserialize deep-equal (all fields) | vitest unit                              |
| TC-02 | schema-version accept/reject                  | vitest unit                              |
| TC-03 | imported record resumes via existing path     | vitest unit (resume path)                |
| TC-04 | export A-store → import B-store → resume on B | functional test (two independent stores) |
| TC-05 | no sharing policy in `packages/`              | code review + targeted grep              |
| TC-06 | artifact path independent of the live channel | dependency check + design assertion      |

## Tasks

`.agents/tasks/SELFHOST-014*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). DESIGN spec: envelope primitive in
`agent-session` + resume-path reuse + app-surface sharing UI/policy.

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
