---
name: audit-project
description: Manually audit this repository's architecture, correctness and enterprise readiness; return evidence, mandatory gate results and changes since a prior run. Use only when the owner explicitly requests this audit.
---

# Audit project

This is our developer workflow. Honor explicit user scope and existing authorization. It neither modifies the delivered runtime nor authorizes repairs, installation, publication or new paid environments.

Read `VISION.md`, `AGENTS.md`, `HARNESS.md` and [the audit contract](references/contract.md). Full scope is the default; narrower scope requires an explicit request and cannot establish whole-project readiness.

1. Freeze the source revision and record dirty/untracked source without discarding it. Establish deployment profiles, required thresholds, available environments and resource bounds; label unspecified targets provisional. Create a run directory outside tracked source containing `result.json`, `report.md` and referenced evidence. Record the skill/contract digest independently of the product revision.
2. Inventory every tracked unit and public entry point again, including nested workspaces, tests, scripts/configuration, documentation, patches and delivery assets. Assign every first-party executable module for full source review. A filename scan is inventory, not review. Generated/vendor exclusions need provenance and a reason. Record each unit's content hash, owner, inspected behavior, checklist IDs and disposition.
3. Run applicable existing checks once under one owner: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm deps:check`. Inspect their actual coverage/skips and add applicable app/example/artifact journeys from the contract. Share results; do not run the whole suite per agent. CLI probes use disposable product state and a temporary child-process home.
4. Use available parallel agents for independent slices of this audit. Calibrate a lower-cost model on a small primary-reviewed batch before assigning bounded inventory/source tasks. Record actual model settings and limitations. Escalate architectural, security, concurrent-effect and recovery conclusions to the main model. Independent reviewers verify high-impact findings, high-risk passes and uncertain lower-model results; sample remaining clean reports and expand review when omissions occur. If delegation is unavailable, report serial execution and the missing independent evidence.
5. Exercise critical product journeys and negative/race/crash controls. Record source inspection, deterministic tests, product integration, stochastic trials and deployed measurements separately. Keep unavailable native/cloud/live lanes incomplete and continue independent work. Follow `SECURITY.md` for vulnerability disclosure; never expose secrets or exploitable details in public reports.
6. Adjudicate every contract obligation using the gate below. Produce the coverage ledger, architecture/trust-flow assessment, evidence index, consolidated findings, profile verdicts and dependency-ordered remediation. An assessment may finish with failures or blocked lanes; unread first-party modules and unresolved report defects prevent claiming a completed full source audit.
7. Compare a prior compatible run, separating product changes from scope/threshold/environment/model changes. Report new/resolved/regressed findings and remaining blockers. Reuse evidence only when revision, configuration and affected dependency/contract scope establish applicability; otherwise invalidate it. Resume only the same frozen inputs, marking pending work incomplete, or create a new run and revalidate changed areas.

## Manual gates

Apply the contract's PASS/FAIL/INCOMPLETE rules to evidence, not agent self-reports. Mandatory failures survive missing evidence and cannot be averaged away. A successfully written report is not a gate pass. No new permanent scanner or automatic CI/release gate is supplied; reuse existing deterministic checks and independent review.

The supported discovery/invocation surface is repository-scoped Codex. `agents/openai.yaml` disables implicit invocation; explicit `$audit-project` still works. Do not claim another host honors this policy without exercising that host. Ordinary development requests must not launch a full audit.
