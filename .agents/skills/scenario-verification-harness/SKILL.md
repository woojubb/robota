---
name: scenario-verification-harness
description: Applies the Robota scenario verification loop by checking scope, preserving canonical ownership, re-recording only when necessary, and stopping on strict-policy failures. Use when scenario files, example flows, or execution-path behavior changes.
---

# Scenario Verification Harness

## Rule Anchor

- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "Execution Safety"
- `AGENTS.md` > "Execution Caching"
- `AGENTS.md` > "Harness Direction"

## Use This Skill When

- Modifying scenario files or example workflows.
- Changing execution behavior that may alter scenario output.
- Reviewing whether a scenario-related change follows repository execution rules.

## Preconditions

- Identify the owning package for the scenario or example.
- Identify the example file and scenario identifier.
- Prefer the owner package `scenario:verify` command when the scope exposes one.
- Prefer the owner package `scenario:record` command when authoritative output must be refreshed.
- Confirm whether the change is a real product behavior change or only a scenario-specific patch.
- If re-recording is required, ensure the required environment variables are present.

## Execution Steps

1. Confirm the change belongs to a general workflow capability, not a scenario-only shortcut.
2. Check ownership:
   - no duplicate declarations
   - no side-channel identity fields when `ownerPath` encodes the relation
   - no inferred linkage or fallback path
3. If package source changed, build the affected package before verification.
4. Run the package-owned scenario verification command and compare its output with the canonical scenario record artifact.
5. If expected behavior changed intentionally, re-record the scenario using the package-owned record command, then verify again.
6. Treat re-record as an overwrite of the authoritative scenario artifact, not an append to stale output.
7. Stop immediately on:
   - non-zero exit
   - strict-policy logs
   - edge-order violations
   - missing or empty expected outputs

## Stop Conditions

- The change exists only to satisfy a scenario artifact rather than the owned product behavior.
- Verification logs contain `[STRICT-POLICY]`, `[EMITTER-CONTRACT]`, or `[EDGE-ORDER-VIOLATION]`.
- Scenario outputs are missing, empty, or ambiguous.
- The change introduces inferred linkage, delayed linkage, or duplicate suppression patterns.

## Checklist

- [ ] Scenario change is justified by owned product behavior.
- [ ] Ownership and `ownerPath` modeling remain canonical.
- [ ] Affected package is built before verification when source changed.
- [ ] Verification is run after any re-record.
- [ ] Scenario artifacts are overwritten authoritatively when re-recording.
- [ ] Strict-policy and missing-output failures stop the loop.

## Focused Examples

```bash
pnpm --filter @robota-sdk/agent-core build
```

```bash
pnpm scenario:verify -- <example-file> <scenario-id>
pnpm scenario -- record <example-file> <scenario-id>
```

If the owning package exposes a package-specific verification entrypoint, prefer that owner command over a guessed root alias.

## Anti-Patterns

- Adding scenario-only fields, keywords, regex, or inference logic.
- Appending to stale scenario outputs instead of overwriting them.
- Re-recording without running verification afterward.
- Treating a cache miss or verification failure as permission to silently run a live fallback path.

## Related Harness Commands

- Current: `pnpm harness:verify -- --scope <packages/foo|apps/bar> --include-scenarios`
- Current: `pnpm harness:record -- --scope <packages/foo|apps/bar>`
- Current: package-owned scenario record and verify commands
