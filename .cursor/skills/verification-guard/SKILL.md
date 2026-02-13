---
name: verification-guard
description: Run guarded example verification by aborting on failed execution or strict policy signals. Use when running example verification or guarded verification flows.
---

# Verification Guard

## Scope
Use this skill when running example workflows that must abort verification on failure or strict policy violations.

## Guarded Execution Template
```bash
cd /Users/jungyoun/Documents/dev/robota/packages/workflow/examples && \
pnpm guarded:verify:template
```

## Package Template Commands
- Guarded example: `pnpm guarded:verify:template`
- Continued conversation example: `pnpm continued:verify:template`
- Generic entrypoint: `pnpm scenario:verify -- <example-file> <scenario-id> [--strategy=hash|sequential]`

## Re-record Workflow Scenarios
- Precondition: `OPENAI_API_KEY` must be set in shell.
- Re-record (clean overwrite):
  - `pnpm scenario -- record guarded-edge-verification.ts mandatory-delegation`
  - `pnpm scenario -- record continued-conversation-edge-verification.ts continued-conversation`
- Then verify:
  - `pnpm guarded:verify:template`
  - `pnpm continued:verify:template`
- Record mode is authoritative and overwrites the target scenario file before recording to avoid duplicate hash ambiguity.

## Stop Conditions
- Non-zero exit code from example execution
- Log contains `[STRICT-POLICY]` or `[EDGE-ORDER-VIOLATION]`
- Expected output files are missing or empty

## Template Maintenance
- Keep verification commands in package-specific templates after example migration.
- Update templates after Phase 2 moves to reflect new example paths.
- Run guarded verification with the updated template before any verification step.
