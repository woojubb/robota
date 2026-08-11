# SELFHOST-014 P1 — async shareable/resumable session artifacts (task breakdown)

Spec: [`.agents/spec-docs/done/SELFHOST-014-shared-async-session-artifacts.md`](../spec-docs/done/SELFHOST-014-shared-async-session-artifacts.md)
(DATA; P1 = the whole library slice; design-gated GATE-APPROVAL ENDORSE). **Reuse the existing `ISessionRecord`
— do NOT invent a format.** Neutral export/import envelope + a reusable opt-in secret-scrub; the sharing UI +
ALL policy (link/cloud/access/redaction FIELD policy) live in `apps/`, never in `packages/`. Async durable
COMPLEMENT to REMOTE-001's live channel — no new transport/pairing/wire.

## Design (approved, P1)

Verified against code: `ISessionRecord` + `SessionStore.save/load` (JSON round-trip) in
`agent-session/src/session-store.ts`; the recursive secret scrub (`SENSITIVE_KEY_PATTERN` +
`[REDACTED]` at `SENSITIVE_KEY_PATTERN.test(key)`) is private + logging-coupled in `session-logger.ts` (covered
by a redaction test in `session-log-replay.test.ts`).

1. **Shared scrub SSOT** — new `agent-session/src/scrub-sensitive.ts`: `SENSITIVE_KEY_PATTERN`,
   `isSensitiveKey(key)`, and the pure recursive `scrubSensitiveKeys(value, redactedValue?)` (redacts values whose
   KEY is sensitive; no logging/externalization concern). The **single source** of the sensitive-key definition.
2. **Logger refactor** — `session-logger.ts` consumes `isSensitiveKey` (delete its private `SENSITIVE_KEY_PATTERN`)
   so exactly one sensitive-key definition exists; behavior preserved (redaction test stays green).
3. **Artifact envelope** — new `agent-session/src/session-artifact.ts` (sibling of `session-store.ts`,
   record-transport not file-persistence): `serialize(record, options?)` — op1 round-trip (no transform, full
   fidelity) / op2 export-for-share (`options.redact: (record)=>record`, app-supplied, policy-free) — + a
   schema-version header + `deserialize(bytes)` (version guard: reject unknown/incompatible). Pure; NO
   link/cloud/access/redaction-policy.
4. **Exports** — `agent-session/src/index.ts` exports the envelope + `scrubSensitiveKeys`/`isSensitiveKey`.
5. **Resume reused as-is** — import = `deserialize → store.save → existing loadSessionRecord` (no new resume logic).
6. **Guard floors** — TC-05 grep floor `scan-session-artifact-neutrality.mjs` (no link/cloud/upload/access/
   redaction-policy tokens in `session-artifact.ts`); TC-06 via the existing `deps` scan (no edge from
   agent-session to agent-remote-pairing / agent-transport-webrtc).
7. **SPEC.md** — record the artifact primitive + two ops + the opt-in scrub under storage-neutral persistence.

## Status

**DONE (2026-07-19).** S1 (scrub SSOT + logger refactor) + S2 (artifact envelope) + S3 (resume + guards + docs) done; all TC-01..08. AGENT-RUN VERIFIED (async share→resume across independent stores + redaction). agent-session 117 / agent-framework 1214 tests, 59/59 scans. Epic ready for GATE-VERIFY→GATE-COMPLETE.

## Slices (each green + committed)

1. **S1 — scrub SSOT + logger refactor** (`scrub-sensitive.ts` + logger consumes `isSensitiveKey`; redaction test green).
2. **S2 — artifact envelope** (`session-artifact.ts` serialize/deserialize/schema-version/redact seam + exports) (TC-01/02/07).
3. **S3 — resume + second-surface + guards + docs** (import→save→loadSessionRecord round-trip test TC-03/04; redacted-resumes-with-rebind TC-08; neutrality grep floor TC-05 + deps TC-06; SPEC.md).

## Test Plan

- **TC-01** round-trip `deserialize(serialize(record))` deep-equals a full-field record (no redact) — fidelity floor.
- **TC-02** schema-version guard: unknown/incompatible version rejected; same-version imports.
- **TC-03** imported artifact resumes via the existing `loadSessionRecord` (messages/history/goal identical).
- **TC-04** export from store A → import into a DISTINCT store B (different baseDir) → resume on B matches; stores independent.
- **TC-05** neutrality grep floor: `session-artifact.ts` has no link/cloud/upload/access/redaction-policy tokens.
- **TC-06** deps scan: no edge from the artifact path to `agent-remote-pairing`/`agent-transport-webrtc`.
- **TC-07** `serialize(record,{redact})` (strip cwd/sandboxSnapshotId + compose the opt-in scrub) → those fields absent/`[REDACTED]`; without redact they remain (TC-01).
- **TC-08** a REDACTED artifact still resumes on B: import → app rebinds the stripped required `cwd` → resume succeeds, messages/history/goal match.
- Regression: `pnpm --filter @robota-sdk/agent-session test`, typecheck, lint, `pnpm harness:scan`.

## Capability-reachability / AGENT-RUN (per `.agents/rules/backlog-execution.md`)

TC-04 + TC-08 ARE the capability verification: export a real session artifact from one store and resume it in a
SECOND independent store (a different surface) — with redaction — proving the async share→resume path end-to-end
with both stores offline/independent. Functional tests the agent runs itself (no live channel).
