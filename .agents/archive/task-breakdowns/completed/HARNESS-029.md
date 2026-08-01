# HARNESS-029 — mechanical memory-neutrality floor over `packages/*/src`

Spec: [`.agents/spec-docs/done/HARNESS-029-memory-neutrality-scan.md`](../../spec-docs/done/HARNESS-029-memory-neutrality-scan.md)
GATE-WRITE: PASS. GATE-APPROVAL: PASS (proposal-reviewer ENDORSE; owner sign-off "HARNESS-029 먼저").
GATE-IMPLEMENT: PASS. Implementation DONE (11 unit tests; harness:scan 56/56). Gates SELFHOST-008 P3/P4.

## Slices (map to Completion Criteria)

- [x] **TC-01 — seeded-memory-content flagged.** A `MEMORY.md` (or `memory/topics/*.md`) path under `packages/*/src`
      is reported `seeded-memory-content` (unit test).
- [x] **TC-02 — library-capture-prompt flagged + suppressible.** A memory-subsystem source with a
      `const CAPTURE_PROMPT = '<≥40-char sentence>'` (identifier matches prompt/persona/instruction) is reported
      `library-capture-prompt`; an adjacent `// allow-memory-content: <reason>` suppresses it (unit test).
- [x] **TC-03 — no false positives.** A short prompt-named token (`const promptId = 'x'`), the existing regex
      extractor/policy constants, and a `prompt` mention in a COMMENT are NOT flagged (unit test, negative fixtures).
- [x] **TC-04 — anti-rot (v1 = reason-less-only).** A reason-less `// allow-memory-content` fails; a well-formed
      `allow-memory-content: <reason>` passes (unit test).
- [x] **TC-05 — registered + green on introduction.** Registered in `run-all-scans.mjs` (→ CI `scans`) + runs at
      GATE-VERIFY; `pnpm harness:scan` GREEN on introduction (live tree has no seeded corpus + no library capture prompt).

## Implementation notes (from GATE-APPROVAL ENDORSE)

1. **Scope class-2 deliberately to the curation subsystem** — match files whose path contains a `/memory/` DIRECTORY
   segment (the durable-memory subsystem convention), NOT "any path containing `memory`" (which would also match
   `in-memory-*`/`memory-cache`/`memory-storage` infra elsewhere). Note the scoping choice in the scan header.
2. **Class-2 is an evadable floor** (a non-matching identifier slips through) — it BACKS the manual TC-06 review, does
   not replace it. Keep the manual-review backstop stated. Class-1 (file-path) is exact.
3. **Class-1 couples to today's corpus layout** (`MEMORY.md` + `topics/*.md`, per `project-memory-store.ts`
   `INDEX_FILENAME`/`TOPICS_DIRNAME`/`TOPIC_EXTENSION`). If a P3/P4 backend changes the layout, update the scan in
   lockstep — note this maintenance coupling in the scan header.

## Design

`scripts/harness/scan-memory-neutrality.mjs`, mirroring `scan-orchestration-neutrality.mjs`: exported pure
`findMemoryNeutralityFindingsInSource(src, file)` (for class-2) + `findMemoryNeutralityFindings()` live-tree walk over
`packages/*/src` (both classes). Class-1 = file-path check (`MEMORY.md`/`memory/topics/**` under `src`). Class-2 =
within `/memory/`-dir sources (non-test), a declaration whose identifier matches `/(prompt|persona|instruction)/i`
assigned a string literal ≥40 chars, suppressed by an adjacent `// allow-memory-content: <reason>`. Anti-rot: a
reason-less `allow-memory-content` (comment-scoped) fails. Register `memory-neutrality` in `run-all-scans.mjs`.

## Test Plan

- **node unit** on the scan (`scripts/harness/__tests__/scan-memory-neutrality.test.mjs`): class-1 seeded-content
  flagged; class-2 capture-prompt flagged + `allow-memory-content` suppress; negatives (short token / reference
  constants / comment) not flagged; anti-rot reason-less fails; live-tree `findMemoryNeutralityFindings()` === [].
- **regression**: `pnpm harness:scan` green on introduction (whole scan set, expect 56/56 after registration).

## Affected Files

- `scripts/harness/scan-memory-neutrality.mjs` (new)
- `scripts/harness/__tests__/scan-memory-neutrality.test.mjs` (new)
- `scripts/harness/run-all-scans.mjs` (register `memory-neutrality`)
