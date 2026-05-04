# SDK Public Surface Owner Audit

## Status

Backlog.

## Priority

P1 - hardens the beta SDK API before compatibility surfaces become accidental contracts.

## Problem

`packages/agent-sdk/src/index.ts` intentionally exposes `InteractiveSession`, command contracts,
SDK common APIs, SDK facades, and SDK-specific safety layers. It also exposes selected symbols from
lower-level owner packages for convenience or compatibility.

Current files to audit:

- `packages/agent-sdk/src/index.ts`
- `packages/agent-sdk/src/types.ts`
- `packages/agent-sdk/src/background-tasks/index.ts`
- `packages/agent-sdk/src/subagents/index.ts`

Some of these exports are legitimate SDK facades. Others may be pass-through surfaces that make
consumers import through the SDK instead of the true owner package, which conflicts with the
repository rule against hiding package ownership.

## Recommended Direction

Classify every SDK public export into one of:

- **SDK-owned API**: implemented or semantically owned by `agent-sdk`.
- **SDK facade**: intentionally narrows or adapts a lower-level package for SDK consumers.
- **Compatibility re-export**: exposed only because earlier code imported it through the SDK.
- **Wrong-owner export**: should be imported from the owning package directly.

Recommended sequence:

1. Generate an export inventory for `packages/agent-sdk/src/index.ts` and nested barrels.
2. Compare each export against `packages/agent-sdk/docs/SPEC.md` and owner package specs.
3. Remove wrong-owner exports in beta instead of preserving compatibility.
4. Namespace or document intentional facades so ownership is visible.
5. Add a harness check for broad `export *` pass-throughs and other high-signal owner drift.

## Acceptance Criteria

- [ ] SDK public exports are classified as SDK-owned API, SDK facade, compatibility re-export, or
      wrong-owner export.
- [ ] Wrong-owner exports are removed or moved behind an explicit SDK-owned facade.
- [ ] `packages/agent-sdk/docs/SPEC.md` describes the resulting public surface ownership.
- [ ] Consumers in this monorepo import lower-package contracts from their owner unless an SDK facade
      is intentionally documented.
- [ ] A mechanical check prevents broad pass-through export drift where feasible.
- [ ] `packages/agent-cli/docs/ARCHITECTURE-MAP.md` reflects the final SDK public surface boundary.

## Verification Plan

- `rg -n "export \\* from '@robota-sdk|export \\* from" packages/agent-sdk/src`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`
