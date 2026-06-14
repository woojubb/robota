# Architecture Conformance — Re-Audit Report — 2026-06-14

Follow-up to `conformance-audit-report.md` (AF-01~AF-37, remediated in PR #779) after the
`doc-claim-verification` skill recursion fix. This pass re-ran the full audit with the **corrected
canonical document set** (recursive `architecture-map/**/*.md`, including the previously-missed
`agent-cli/` subtree) to confirm the first remediation held and to sweep for residual drift.

## Mechanical baseline (Step 1)

| Check                 | Result                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `harness:conformance` | `conformant: true` — dependencyDirection pass, 0 package-name violations, 0 unknown package tokens |
| `harness:scan`        | 25/25 scans passed                                                                                 |

Deterministic floor: **PASS**. No code-level / dependency-graph / interface-boundary violations.

## Coverage (Step 2)

Enumerated mechanically — `find .agents/specs/architecture-map -name '*.md'` (recursive, including
`agent-cli/`) + `ls packages/*/docs/SPEC.md` + the three roots. **38 documents** verified across 3
parallel verification agents. No silent scoping.

## Findings

0 P0. 17 findings, all **documentation drift** (code is correct; docs lag the beta.75 surface). Grouped
by document tier.

### RA — architecture-map roots & top-level docs (6)

| ID    | Document                           | Verdict | Issue                                                                                                |
| ----- | ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| RA-01 | `capability-placement.md`          | STALE   | surviving `agent-team` node + `ITuiCliAdapter` mis-attribution                                       |
| RA-02 | `ARCHITECTURE-MAP.md`              | STALE   | broken `agent-team.md` router/tree link (no such doc/package)                                        |
| RA-03 | `transport-architecture.md`        | DRIFT   | `ITuiCliAdapter` owner wrong; false "not even agent-core" zero-dep claim; agent-cli dep transitivity |
| RA-04 | `cross-cutting-contracts.md`       | DRIFT   | `ITuiCliAdapter` ownership row stale                                                                 |
| RA-05 | `ARCHITECTURE-MAP.md`              | DRIFT   | missing Commands → Preset edge (PRESET-006)                                                          |
| RA-06 | `agent-cli/target-architecture.md` | DRIFT   | missing Commands → Preset edge in agent-cli composition                                              |

### RB — preset/runtime package SPECs (9)

| ID    | Document                  | Verdict | Issue                                                                                                       |
| ----- | ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| RB-01 | `agent-framework/SPEC.md` | DRIFT   | `selectCommandModules` documented as public barrel export but only on `commands/index.ts` → marked internal |
| RB-02 | `agent-session/SPEC.md`   | DRIFT   | "standalone classes" vs reality `Session extends SessionBase`                                               |
| RB-03 | `agent-session/SPEC.md`   | STALE   | `session-base.ts` / script path / `agent-sdk → agent-framework` rename                                      |
| RB-04 | `agent-command/SPEC.md`   | STALE   | phantom `orgPolicy` param on a command signature                                                            |
| RB-05 | `agent-command/SPEC.md`   | DRIFT   | `agent-sdk` ghost ref (renamed to agent-framework)                                                          |
| RB-06 | `agent-transport/SPEC.md` | DRIFT   | `headless/` directory duplicate listing                                                                     |
| RB-07 | `agent-transport/SPEC.md` | STALE   | stale file/test counts (→ 61 files / 476 tests)                                                             |
| RB-08 | `agent-core/SPEC.md`      | DRIFT   | plugin-module wording + `agent-sdk → agent-framework`                                                       |
| RB-09 | `agent-session/SPEC.md`   | DRIFT   | residual `agent-sdk` reference                                                                              |

### RC — remaining package SPECs (2)

| ID    | Document                            | Verdict | Issue                                                              |
| ----- | ----------------------------------- | ------- | ------------------------------------------------------------------ |
| RC-01 | `agent-tools/SPEC.md`               | STALE   | ghost `OpenAPITool` / `createOpenAPITool` exports (do not exist)   |
| RC-02 | `agent-interface-transport/SPEC.md` | DRIFT   | understated type ownership; incorrect "no types imported" sentence |

## Remediation

All 17 remediated in this pass (documentation-only, no code touched), verified against source:

- **RA-01~RA-06** — architecture-map docs: removed the `agent-team` ghost node/link, corrected
  `ITuiCliAdapter` ownership, removed the false zero-dep absolute, added the Commands → Preset edge.
- **RB-01~RB-09 / RC-01~RC-02** — package SPECs: `selectCommandModules` marked internal, `Session extends
SessionBase` corrected, phantom `orgPolicy` removed, `agent-sdk → agent-framework` ghost refs purged,
  `headless/` dedup, counts refreshed, ghost `OpenAPITool`/`createOpenAPITool` removed, interface-transport
  type ownership enumerated correctly.

Post-remediation: `harness:scan` 25/25 green, `harness:conformance` conformant.

## Verdict

**Mechanical: PASS. Analytic: all 17 findings remediated → all claims now HOLD. 0 P0, 0 code defects.**

Root cause is unchanged from the first audit (`three_doc_layers_sync` lapse — docs lag code after gated
feature PRs). The standing guard recommendation remains `INFRA-DOC-GUARD-001` (ghost-package blocking
check + spec-export-coverage warning), which would have caught RA-01/02 (ghost `agent-team`) and the
ghost-export findings (RC-01) mechanically. No release blocker.
