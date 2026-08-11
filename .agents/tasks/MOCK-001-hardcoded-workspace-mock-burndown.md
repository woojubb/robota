---
title: 'MOCK-001: burn down the allowlisted hardcoded workspace-module mocks'
status: in-progress
created: 2026-07-02
priority: medium
urgency: later
area: packages/* test suites, scripts/harness
depends_on: []
---

# Hardcoded workspace-mock burn-down

The `test-module-mocks` harness scan (added 2026-07-02) blocks NEW
`vi.mock('@robota-sdk/agent-core', () => ({ hardcoded }))` factories: such a stub severs every other export
of the package for the whole import graph and breaks when the real module grows — the exact failure
that blocked every `git push` when TERM-008 added `resolvePlatformShell` while agent-playground's
2-export stub of agent-core was in place (CI stayed green; only the full local suite caught it).

The scan's `ALLOWLIST` (in `scripts/harness/check-test-module-mocks.mjs`) pinned the pre-existing
violation files so the gate could land without a mass rewrite. This item tracks the burn-down.

## What

For each allowlisted file, either:

1. Convert to a partial mock — `vi.mock(mod, async (importOriginal) => ({ ...(await importOriginal()),
<overrides> }))` — and delete its allowlist entry; or
2. If the full replacement is deliberate (e.g. a leaf test isolating a provider SDK from the network
   and the import graph genuinely never reaches other exports), annotate the `vi.mock` line with
   `// allow-module-mock: <reason>` and delete its allowlist entry.

Work in per-package batches (each batch = suite green). Done when `ALLOWLIST` is empty and the scan
text drops the legacy note.

## Burn-down progress

| Date                      | Allowlist size | Change                                                      |
| ------------------------- | -------------- | ----------------------------------------------------------- |
| 2026-07-02                | 36             | initial sweep                                               |
| (pre-existing on develop) | 32             | 4 cleared by earlier incidental work                        |
| 2026-07-25                | **3**          | HARNESS-025 pass — detector fix (20) + real conversions (9) |

### 2026-07-25 — 32 → 3

Two thirds of the list were **never hardcoded**. The detector recognized only the literal
`importOriginal`, so the equally-correct `vi.importActual` spread form was misreported; and it
searched a fixed 600-character window, which long factories overflowed before reaching their spread.
Both gaps are fixed in `check-test-module-mocks.mjs` (balanced-paren factory extraction + both
original-import spellings), and the scan now requires the original to actually be **spread**, not
merely loaded — a factory that fetches the original and drops it severs exports just like a
hardcoded one, which the old check would have passed.

- **20 entries cleared by the detector fix** — already-correct partial mocks (all 6 `agent-session`,
  6 of the `agent-framework` entries, `agent-provider-anthropic/response-parser`, all 3
  `agent-transport-tui/TuiInteractionChannel.*`, and 4 `dag-cli` files). No test changed.
- **9 entries cleared by real conversions** — 5 `dag-cli` files (`describe-command`,
  `explain-suggest`, `fix-command`, `from-mermaid-command`, `runner-cli`; `fix-command` also had an
  unlisted hardcoded `dag-builder` mock, converted too), 2 `dag-nodes` files
  (`gemini-image-edit/runtime-core`, `instant-node/index` — 6 mocked modules between them), plus
  `dag-nodes/llm-text/index` which was already clean and merely still pinned.
- **Anti-rot guard added**: an allowlist entry whose file is now clean (or gone) fails the scan.
  The allowlist can now only shrink, so a stale entry can never again inflate the remaining count.

## Remaining (3)

All three are genuine hardcoded factories. They were left untouched only because they sit in
packages owned by a concurrent work-stream (ARCH-005 S2), not because they are load-bearing:

- `packages/agent-cli/src/__tests__/provider-factory-integration.test.ts` — 4 provider modules
- `packages/agent-framework/src/__tests__/create-subagent-session.test.ts` — `@robota-sdk/agent-session`
- `packages/agent-framework/src/__tests__/subagent-integration.test.ts` — `@robota-sdk/agent-session`

Closing these three empties the allowlist and completes the item.

## Test Plan

- Per batch: converted files' suites pass; `node scripts/harness/check-test-module-mocks.mjs` exit 0.
- Final: `ALLOWLIST` empty; `pnpm harness:scan` green; full `pnpm test` green.

## User Execution Test Scenarios

- Not applicable (test-infrastructure refactor; the scan itself is the maintained gate). Evidence is
  the shrinking allowlist + green suites per batch, recorded here.
- Evidence (2026-07-25): `node scripts/harness/check-test-module-mocks.mjs` →
  `test-module-mocks scan passed (3 legacy allowlisted).` (was 32). Suites green and unchanged in
  count vs. baseline: `dag-cli` 63 files / 1007 tests, `dag-nodes` 351 tests across 20 packages,
  `agent-transport-tui` 69 files / 526 tests. Scan unit tests 18/18, including 4 new cases pinning
  the anti-rot guard and 3 pinning the two detector gaps.
