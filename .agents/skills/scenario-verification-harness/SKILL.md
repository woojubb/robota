---
name: scenario-verification-harness
description: Verify a change against a recorded scenario — check scope, preserve canonical ownership of the recorded artifact, re-record only on intentional behavior change, and stop on verification failures. Use when scenario files, example flows, or execution-path behavior changes.
---

# Scenario Verification Harness

Generic leaf workflow: verify changed behavior against an authoritative recorded scenario artifact.
The owning package's own verify/record commands are the SSOT for how a scenario runs; this skill only
defines the loop around them.

## Rule Anchor

- [.agents/rules/verification.md](../../rules/verification.md)

## Use This Skill When

- Modifying scenario files or example workflows.
- Changing execution behavior that may alter recorded scenario output.
- Reviewing whether a scenario-related change follows repository execution rules.

## Preconditions

- Identify the owning package for the scenario or example.
- Identify the example file and scenario identifier.
- Prefer the owner package's `scenario:verify` command when the scope exposes one.
- Prefer the owner package's `scenario:record` command when authoritative output must be refreshed.
- Confirm whether the change is a real product behavior change or only a scenario-specific patch.
- If re-recording is required, ensure the required environment variables are present.

## Execution Steps

1. Confirm the change belongs to a general workflow capability, not a scenario-only shortcut.
2. Check ownership modeling: no duplicate declarations, no side-channel identity fields when an
   existing ownership field already encodes the relation, no inferred linkage or fallback path.
3. If package source changed, build the affected package before verification.
4. Run the package-owned scenario verification command and compare its output with the canonical
   scenario record artifact.
5. If expected behavior changed intentionally, re-record the scenario using the package-owned record
   command, then verify again.
6. Treat re-record as an overwrite of the authoritative scenario artifact, not an append to stale
   output.
7. Stop immediately on:
   - non-zero exit
   - policy-violation or contract-violation log markers emitted by the harness
   - ordering-invariant violations
   - missing or empty expected outputs

## Stop Conditions

- The change exists only to satisfy a scenario artifact rather than the owned product behavior.
- Verification logs contain policy-violation or contract-violation markers.
- Scenario outputs are missing, empty, or ambiguous.
- The change introduces inferred linkage, delayed linkage, or duplicate suppression patterns.

## Checklist

- [ ] Scenario change is justified by owned product behavior.
- [ ] Ownership modeling remains canonical.
- [ ] Affected package is built before verification when source changed.
- [ ] Verification is run after any re-record.
- [ ] Scenario artifacts are overwritten authoritatively when re-recording.
- [ ] Policy-violation and missing-output failures stop the loop.

## Focused Examples

```bash
pnpm --filter <owner-package> build
pnpm --filter <owner-package> scenario:verify -- <example-file> <scenario-id>
pnpm --filter <owner-package> scenario:record -- <example-file> <scenario-id>
```

If the owning package exposes a package-specific verification entrypoint, prefer that owner command
over a guessed root alias.

## Anti-Patterns

- Adding scenario-only fields, keywords, regex, or inference logic.
- Appending to stale scenario outputs instead of overwriting them.
- Re-recording without running verification afterward.
- Treating a cache miss or verification failure as permission to silently run a live fallback path.

## Related Harness Commands

- `pnpm harness:verify -- --scope <packages/foo|apps/bar> --include-scenarios`
- `pnpm harness:record -- --scope <packages/foo|apps/bar>`
- Package-owned scenario record and verify commands
