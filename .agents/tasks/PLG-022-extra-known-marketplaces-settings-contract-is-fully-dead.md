---
title: 'PLG-022: marketplace-source persistence is split-brain — the settings-based extraKnownMarketplaces contract (schema, merge, resolved field, and a full get/set/remove store API) is written and read by nothing, while the live registry is a separate known_marketplaces.json'
status: todo
created: 2026-08-13
priority: medium
urgency: later
area: packages/agent-framework
depends_on: []
---

# PLG-022: two marketplace-source designs, one inert

## Problem

There are two persistence designs for the same fact (extra marketplace source URLs). The one the
config schema documents, validates, merges, resolves, and provides a store API for
(`extraKnownMarketplaces`) has zero production callers and zero readers; the live registry is a
separate `known_marketplaces.json`. A user adding `extraKnownMarketplaces` to settings.json gets a
schema-validated silent no-op.

## Evidence (round-2 framework-subsystems audit, 2026-08-13)

- `config-types.ts:157-158,201-205` — `extraKnownMarketplaces` ("Extra marketplace URLs for
  BundlePlugin discovery") schema-validated, merged (`config-loader.ts:145`), resolved (`:215`);
  `plugin-settings-store.ts:96-121` implements get/set/remove for it.
- Zero production callers of `getMarketplaceSources`/`setMarketplaceSource`/`removeMarketplaceSource`
  (repo-wide grep) and zero readers of `IResolvedConfig.extraKnownMarketplaces`; the live registry is
  `known_marketplaces.json` (`marketplace-client.ts:51,105-119`).

## Direction

Decide one design: either make `MarketplaceClient` fold settings-declared `extraKnownMarketplaces`
sources into discovery (so the config key is honored), or delete the settings key, the
`IResolvedConfig.extraKnownMarketplaces` field, and the dead `PluginSettingsStore` methods. One
persistence path for one fact.

## Test Plan

- Red-first: an `extraKnownMarketplaces` URL in settings.json appears in marketplace discovery (fails
  today), OR the settings key and store methods are removed and `rg` shows no references.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies only if the "wire it" option is chosen** (marketplace sources are user-configurable): adding
`extraKnownMarketplaces` to settings.json makes that marketplace's plugins discoverable via `/plugin`.
If resolved by deletion: Not applicable — record the contract removal in the Test Plan.
