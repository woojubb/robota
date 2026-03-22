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

### Reverse Spec Verification (Code → Spec)

- Any refactoring that affects package boundaries (dependency changes, export additions/removals, class splits/moves) MUST be followed by a reverse verification of the affected package's SPEC.md.
- The verification checks that the SPEC still accurately describes the current code — not just that the code matches the spec.
- A refactoring without updated SPEC.md is an incomplete change, same as a spec change without conformance verification.

### Cross-Package SPEC Reference Policy

- SPEC.md MUST NOT hardcode counts, lists, or implementation details owned by another package (e.g., "6 built-in tools" when the tools are owned by a different package).
- When referencing another package's details, either reference the owning package's SPEC or describe only what is observable from the current package's own code.
- If cross-package details must be stated, annotate with the owning package name so staleness can be tracked (e.g., "8 built-in tools (per agent-tools)").
