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

- `providerOverride`: remove it from `IProductProfile` (the shell-side resolution is the actual
  design), or fold it into `assembleProduct`'s provider resolution and document it in the SPEC's
  precedence chain. (Contract removal is a published-surface change — semver/changeset gate.)
- `ICapabilityPack.id`: either implement duplicate-pack detection / add pack provenance to
  `IRejectedCapability`, or correct the field's doc to "diagnostics" (not duplicate-detection).

## Test Plan

- Red-first (providerOverride, if folded): a profile with `providerOverride` set selects that provider;
  (if removed) the field no longer exists on the contract.
- Red-first (id, if implemented): merging two packs with the same id produces a rejection naming the
  duplicate id; (if doc-only) the field's TSDoc no longer claims duplicate detection.
- `pnpm harness:verify -- --scope packages/agent-product` and `--scope packages/agent-capability-pack`
  green; changeset present if the profile contract changes.

## User Execution Test Scenarios

**Applies to providerOverride only if folded** (product assembly is public SDK usage): a scratch
product profile setting `providerOverride` selects that provider at assembly. If both fields are
resolved by removal/doc-correction: Not applicable — record the contract change + changeset in the
Test Plan.
