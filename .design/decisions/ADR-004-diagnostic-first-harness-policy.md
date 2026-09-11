# ADR-004: Make repository harness policy diagnostic-first

## Status

accepted

## Context

Robota's repository harness currently combines two different concerns: ordinary product-quality
signals (such as compilation, typechecking, linting, tests, and dependency-security checks) and
repository-process policy (such as branch, task, approval, documentation, scan, hook, and merge
ceremony). The latter is implemented across scan exit codes, PreToolUse hooks, Husky hooks, gate
commands, workflow conditions, and required-status configuration. It can veto an agent action after
identifying a policy concern.

The owner direction is to retain clear, actionable notice of predefined problems without forcing a
detailed workflow. A policy detector failure must not be reported as clean merely because the default
command does not block. The diagnostic must identify what was examined, what failed, the evidence,
severity, and a next action. This decision governs repository-maintenance policy only; it does not
weaken product correctness or security-quality standards.

## Alternatives Considered

1. **Keep the existing enforcement model and remove only dead checks.**
   - Pros: smallest short-term migration and no change to current veto behavior.
   - Cons: retains the owner-rejected failure mode—process ceremony blocks work even after the concern
     is known.
2. **Make each existing check advisory in place.**
   - Pros: fast conversion of exit codes and workflow statuses.
   - Cons: leaves a fragmented reporting model, makes an unavailable detector easy to mistake for a
     clean run, and preserves the oversized registry and duplicate machinery.
3. **Use a shared diagnostic result/report contract, then migrate or retire every process-policy
   veto (chosen).**
   - Pros: separates detection from blocking, keeps every finding and detector failure visible, and
     gives each retired mechanism an auditable disposition.
   - Cons: policy debt can merge more readily, so summaries, artifacts, stable identifiers, and
     recommendations must be consistently available.

## Decision

Repository-process policy is diagnostic-first and non-vetoing by default. A shared private harness
contract represents four states: `clean`, `finding`, `unavailable`, and
`diagnostic-publication-unavailable`. Each non-clean result has a stable identifier, severity,
examined subject or location, evidence, and recommended next action. A policy finding, detector
failure, timeout, or output truncation must be rendered in the final report even when the default
diagnostic command exits successfully. A failure to publish the durable report emits a direct explicit
notice and is never represented as clean.

The contract belongs in an I/O-free, private `scripts/harness/diagnostic-core.mjs`, with a separate
harness-local renderer. It mirrors the reuse boundary of `scripts/harness/shared.mjs`, not a product
package: repository-policy diagnostics have no product API consumer. Runners, receipt storage, hook
adapters, and CI adapters depend on the core; the core and renderer do not import the scan runner or
product packages.

Every current scan registration, hook registration, Husky exit source, gate/process entrypoint, and
required-status context receives one versioned migration-manifest disposition: retained diagnostic,
retained product/security quality, or retired with rationale. The manifest is the fixed denominator
for migration and prevents an implementation deletion from making a known policy concern invisible.
The structured result/report contract is the only permitted migration target for an existing
repository-policy veto: a replacement may not introduce a standalone message or exit-code channel
that omits the result identity, examined subject, evidence, and recommended next action.

Compilation, typechecking, linting, unit/functional tests, and dependency-security quality checks
remain separate validity signals. They are not silently demoted by this decision. Any later decision
to change their blocking behavior requires a separate proposal and evidence.

## Consequences

- Agents receive concise actionable findings rather than local workflow vetoes for repository policy.
- A failed detector is distinguishable from a clean detector result in local output and CI artifacts.
- Existing process-gate/hook/scan code can be deleted only after its manifest disposition and visible
  replacement or retirement rationale are verified.
- CI must split repository-process diagnostics from retained product/security quality contexts and
  reconcile its required-status matrix with effective GitHub rulesets.
- The initial migration needs stronger result, receipt-reuse, report-publication, and visibility tests
  before legacy enforcement can be safely removed.

## References

- [Issue #2698](https://github.com/woojubb/robota/issues/2698)
- `.agents/spec-docs/todo/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md`
- `/tmp/robota-harness-diet-plan.md`
