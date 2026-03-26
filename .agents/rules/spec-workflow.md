# Spec Workflow Rules

Rules governing spec-first development, conformance verification, and spec maintenance.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Spec-First Development

- Any change touching a contract boundary (package imports, class dependencies, service connections, cross-package types) MUST update or create the governing spec BEFORE writing implementation code.
- Spec format follows the boundary type:
  - HTTP API → standardized API specification (e.g., OpenAPI)
  - Package public surface → `docs/SPEC.md`
  - Class/interface dependency → contract definition in the owning package
- Every spec change MUST include a verification test plan.
- Implementation code that does not conform to its governing spec is a bug.
- See [`spec-first-development`](../skills/spec-first-development/SKILL.md) skill for the procedural workflow.

### Feature Gap / Behavior Change Process

When a feature gap, missing behavior, or spec-vs-implementation mismatch is discovered during development:

1. **Stop coding.** Do not implement a fix or new behavior before the spec is updated.
2. **Ask the user:** "This requires a spec change. Should I add it to the backlog, or proceed now?"
3. **If proceeding:** Update the spec document first to describe the intended final state.
4. **Then implement** the code to match the updated spec.
5. **Verify conformance** between updated spec and implementation.

Skipping step 1–3 (coding before spec) is a process violation. This applies even to "obvious" fixes — if the fix changes observable behavior, the spec must reflect it first.

### Spec-Code Conformance Verification

- Any SPEC.md or contract document change MUST be followed by a conformance verification loop before the change is considered complete.
- The spec is the source of truth. The loop compares every spec assertion against implementation code, lists all gaps, and fixes the **code** (not the spec) to match.
- Each code fix MUST include a corresponding contract test.
- The loop repeats until zero discrepancies remain, then regression tests for all affected packages MUST pass.
- A spec change without conformance verification is an incomplete change.
- **Any code change MUST be preceded by a spec update.** Update the SPEC first to describe the intended state, then modify code to conform. Never modify code without updating or verifying the governing spec.
- See [`spec-code-conformance`](../skills/spec-code-conformance/SKILL.md) skill for the full procedure.

### ABSOLUTE RULE: Verification does not modify SPEC to match code

- During SPEC-Code verification, if a mismatch is found, **ALWAYS fix the code to match the SPEC**. NEVER modify the SPEC to match the code as a verification fix.
- The SPEC is the source of truth during verification. Modifying the SPEC to match code during verification **invalidates the entire verification process**.
- If the code was intentionally changed and the SPEC is now outdated, this is a **process violation** — the SPEC should have been updated BEFORE or TOGETHER WITH the code change, not during the verification step.
- **Exception: SPEC itself is wrong.** If the SPEC contains errors, contradictions, or inaccuracies, it is valid to correct the SPEC — but this must be done as a **separate deliberate action** before code verification:
  1. Stop code verification
  2. Validate and correct the SPEC (separate step, clearly intentional)
  3. Confirm the SPEC is accurate
  4. Restart code verification from scratch against the corrected SPEC
- The key distinction: fixing a genuinely wrong SPEC is acceptable. Changing a correct SPEC to avoid fixing code is not.

### Reverse Spec Verification (Code → Spec)

- Any refactoring that affects package boundaries (dependency changes, export additions/removals, class splits/moves) MUST be followed by a reverse verification of the affected package's SPEC.md.
- The verification checks that the SPEC still accurately describes the current code — not just that the code matches the spec.
- A refactoring without updated SPEC.md is an incomplete change, same as a spec change without conformance verification.

### Cross-Package SPEC Reference Policy

- SPEC.md MUST NOT hardcode counts, lists, or implementation details owned by another package (e.g., "6 built-in tools" when the tools are owned by a different package).
- When referencing another package's details, either reference the owning package's SPEC or describe only what is observable from the current package's own code.
- If cross-package details must be stated, annotate with the owning package name so staleness can be tracked (e.g., "8 built-in tools (per agent-tools)").
