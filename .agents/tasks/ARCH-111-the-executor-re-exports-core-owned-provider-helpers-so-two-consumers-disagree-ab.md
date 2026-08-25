---
title: 'ARCH-111: the executor re-exports core-owned provider helpers so two consumers disagree about the owner'
issue: https://github.com/woojubb/robota/issues/2051
status: todo
created: 2026-08-25
priority: medium
urgency: soon
area: packages/agent-executor, packages/agent-framework
depends_on: []
---

# ARCH-111: one function, two exporting packages, two consumers that disagree

## Problem

`normalizeProviderConfig` and `createProviderFromConfig` are owned by `agent-core`. `agent-executor`
re-exports both. Measured at `c1c3ac079`, the product imports the same function from both packages at
once:

```
agent-framework/src/command-api/provider/provider-factory.ts:2   createProviderFromConfig  ← agent-executor
agent-framework/src/command-api/provider/provider-merge.ts:1     normalizeProviderConfig   ← agent-executor
agent-product/src/assemble-product.ts:2                          createProviderFromConfig  ← agent-core
```

**Both compile, and nothing notices.** This is not a facade being preferred over an owner; it is two
consumers inside one product holding different answers to who owns the symbol.

## Why the duplicate exists, and why that reason is gone

`agent-executor/src/providers/provider-factory.ts:14` states its purpose:

> Re-exported here so existing `@robota-sdk/agent-executor` consumers are unaffected.

And ARCH-PROVIDER-003, which created it, at line 68: _"re-exports from the new location (no consumer
break)."_

**That is a backward-compatibility guarantee, and this repository does not make one** — the owner's
standing ruling is that legacy is not a consideration before release. So the duplicate's only stated
justification no longer applies.

**The ground for removing it is NOT that it has few consumers.** A public interface is not removed for
having one caller or none; that is explicitly ruled out. The ground is that the symbol has one owner,
the duplicate name exists solely for a guarantee this repository does not make, and **its presence is
what allows two consumers in one product to disagree about the owner.** That is a design argument, and
it is the only one this record makes.

## Why this is mechanical

Checked rather than assumed:

- `agent-framework/package.json` already lists `@robota-sdk/agent-core` as a dependency;
- `agent-framework/src` already imports from `@robota-sdk/agent-core` in **156 files**.

So repointing two import lines adds no dependency edge and changes no behaviour. It deletes a
duplicate name.

## Direction

Remove `export { normalizeProviderConfig, createProviderFromConfig }` from
`agent-executor/src/providers/provider-factory.ts` and its onward re-exports in
`agent-executor/src/providers/index.ts` and `agent-executor/src/index.ts`. Point
`agent-framework`'s two imports at `@robota-sdk/agent-core`. Update
`agent-executor/docs/SPEC.md`'s export list to stop listing what the package no longer exports.

`resolveProfileApiKey` and `createProviderFromProfile` **stay** — they depend on the executor-owned
`ISerializableProviderProfile` and are not re-exports of anything.

## Test Plan

- `agent-executor` no longer exports either name: a type-level assertion, not a `grep`, so the check
  fails at compile time if the export returns.
- `agent-framework`'s provider tests still pass with the import repointed, proving the two functions
  are the same function and the facade added nothing.
- **Positive control**: `agent-core` still exports both, so a suite proving the executor dropped them
  cannot pass against a workspace that lost them entirely.
- `pnpm harness:scan` green, `tsgo --noEmit` clean across the workspace — the compiler is the real
  check here, since a missed consumer is a build failure rather than a silent fallback.

## Not in scope

Injecting an environment resolver, and `resolveProfileApiKey`'s second ambient read — issue #2347.
That half changes a published `agent-core` export named in two SPECs, so it carries its own decision.

## User Execution Test Scenarios

Not authorable, and left unwritten with the reason recorded rather than filled with a placeholder.
This item deletes a duplicate export and repoints two imports at the same function; `robota`'s
behaviour, output and exit codes are identical before and after, which is the acceptance criterion
rather than a gap in it.

**This reason does not expire.** It is a property of what the item delivers, not of an undecided
disposition. If a later revision changes user-visible behaviour, that revision needs scenarios and this
paragraph does not cover it.
