# HARNESS-030 — capability-reachability mechanical floor

## STATUS: DONE — merged #1255 (impl) + #1256 (GATE-COMPLETE), on develop (2026-07-20)

In-repo mirror (memory-mirroring rule) of HARNESS-030. Host mirror: session memory
`harness-030-capability-reachability-floor.md`.

Mechanizes the DECLARED half of the capability-reachability done-gate (from
[agent-run-capability-verification](agent-run-capability-verification.md) / `backlog-execution.md`):
`scripts/harness/scan-capability-reachability.mjs` (registered in `run-all-scans.mjs`) walks
`.agents/spec-docs/done/` and fails a spec that DECLARES itself a capability but dodges agent-run evidence.
Fences the "declared-then-dodge" recurrence — SELFHOST-008 shipped memory OFF with the user-execution gate
marked N/A.

## Opt-in via 3 frontmatter keys

Documented in `check-spec-doc-frontmatter.mjs` (RULE-011 frontmatter SSOT):

- `capability: true` — author (confirmed by the GATE-COMPLETE reviewer) declares a user-facing capability.
- `user_execution: agent-run | manual | none` — how the user-execution gate was met.
- `user_execution_scenario: <path>` — EXPLICIT path to the agent-run evidence file. NOT a filename/base-ID
  guess: a spec's evidence may live under a differently-named scenario (e.g. SEC-001's evidence is the
  GUI-007 scenario). The scan verifies the path EXISTS.

## Enforcement + scope

- `capability: true` spec MUST NOT record `user_execution: none` / omit it (no N/A dodge).
- `capability: true` + `agent-run` MUST name a `user_execution_scenario:` that exists.
- A spec WITHOUT `capability: true` is not checked (zero false positives).
- SCOPE (honest): only the DECLARED half. "Is this a capability / is the seam truly reachable" stays with the
  GATE-COMPLETE reviewer; a warn-only undeclared-candidate surfacer is a DEFERRED follow-up.

## House scan pattern

Pure `evaluateSpec(fm, filename, scenarioExists)` + live `findCapabilityReachabilityFindings()` +
red/green vitest fixtures (9 tests, incl. quote-strip) + register in `run-all-scans.mjs`. `parseFrontmatter`
strips a single layer of surrounding quotes. Design passed proposal-reviewer REVISE (filename-substring
matcher → explicit path) + pr-review SHOULD (rule-doc drift to the pre-REVISE design) — both resolved.
