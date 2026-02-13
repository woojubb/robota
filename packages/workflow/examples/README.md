### Examples

Package-owned examples for `@robota-sdk/workflow`.

#### Files
- `guarded-edge-verification.ts`: Workflow edge verification (guarded, scenario).
- `continued-conversation-edge-verification.ts`: Continued conversation edge verification.
- `playground-edge-verification-deprecated.ts`: Deprecated playground verification (confirm removal policy).

#### Utilities
- `utils/scenario-cli.ts`: Single scenario CLI entrypoint (`record`/`play`/`verify`).
  - Default play strategy is `hash` unless `--strategy=sequential` is explicitly provided.
- `utils/verify-workflow-connections.ts`: Workflow connection validator.
- `utils/migrate-scenario-fixtures.mjs`: Scenario fixture migration utility.

#### Guarded Verification Templates
- `pnpm guarded:verify:template`
  - Runs `guarded-edge-verification.ts` with `mandatory-delegation` scenario and `hash` strategy.
- `pnpm continued:verify:template`
  - Runs `continued-conversation-edge-verification.ts` with `continued-conversation` scenario and `hash` strategy.

#### Re-record Standard Procedure
- Precondition: set `OPENAI_API_KEY` in shell (record mode requires a real provider credential).
- Re-record commands:
  - `pnpm scenario -- record guarded-edge-verification.ts mandatory-delegation`
  - `pnpm scenario -- record continued-conversation-edge-verification.ts continued-conversation`
- Verify commands:
  - `pnpm guarded:verify:template`
  - `pnpm continued:verify:template`
- Recording behavior: record mode always overwrites `scenarios/<scenario-id>.json` before execution to prevent hash ambiguity and unused-step drift.
