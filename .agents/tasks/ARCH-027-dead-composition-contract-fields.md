---
title: 'ARCH-027: two published composition-contract fields are folded by nobody — IProductProfile.providerOverride is never read, and ICapabilityPack.id serves a duplicate-pack reporting that is implemented nowhere'
status: todo
created: 2026-08-13
priority: medium
urgency: later
area: packages/agent-product, packages/agent-capability-pack
depends_on: []
---

# ARCH-027: dead fields on published composition contracts

## Problem

Two fields on published composition contracts promise behavior the code does not deliver: a third
party setting them gets a silent no-op, and the SPECs disagree with the contracts about the fields'
own surfaces.

## Evidence

- `packages/agent-product/src/product-profile.ts:67-68` — `providerOverride?: string` ("Active-provider
  override id (data)"). `assemble-product.ts:112-179` never reads it; it is not surfaced on
  `IAssembledProduct`; robota routes the override through `readProviderSettings(cwd, { providerOverride:
args.provider })` BEFORE building the profile (`agent-cli/src/cli.ts:262-265`), and
  `createRobotaProfile` never sets the field. Repo-wide: no reader. The SPEC's provider-resolution
  precedence (`docs/SPEC.md:122-125`) omits the field, so contract and SPEC disagree about the
  profile's own surface.
- `packages/agent-capability-pack/src/capability-pack-types.ts:29-30` — `id` documented as serving
  "duplicate-pack reporting". `merge-capability-packs.ts` never reads `pack.id`; `IRejectedCapability`
  (`:54-58`) carries no pack provenance; two packs with one id are undetected.

## Direction

Remove `IProductProfile.providerOverride`: the shell owns provider-name selection and passes already
resolved `providerSettings` into product composition. Preserve the existing shell override behavior and
record the published-contract removal with the required changeset. Make `ICapabilityPack.id` effective:
reject a later duplicate pack as a whole before merging any of its capabilities, and attach `packId`
provenance to capability-collision diagnostics.

## Test Plan

- Red-first type test asserts `providerOverride` is absent while CLI/shell override behavior remains.
- Red-first merge tests assert a later duplicate pack is rejected atomically and capability collisions
  include `packId` provenance.
- `pnpm harness:verify -- --scope packages/agent-product` and `--scope packages/agent-capability-pack`
  green; changeset present if the profile contract changes.

## User Execution Test Scenarios

Not applicable — this item removes a dead profile field and strengthens composition diagnostics without
changing the shell's already-resolved provider-selection behavior. Record the contract test, regression
test, and changeset as engineering evidence.
