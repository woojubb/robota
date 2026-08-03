---
title: 'HARNESS-067: non-neutrality survived the diet that named it the dominant finding, and it fails as a silent pass'
status: done
completed: 2026-08-03
created: 2026-08-02
priority: high
urgency: next
area: scripts/harness
depends_on: []
---

# HARNESS-067: config and hardcoding coexist inside one file

## Problem

The harness presents itself as a general, portable tool. Repo-specific literals remain baked into it
— and where they do, changing the thing they hardcode does not raise an error. It makes the rule
match nothing, which reads as a pass.

## Evidence

From an external read-only investigation (2026-08-02), re-verified here: `check-dependency-direction.mjs`
contains **13** occurrences of the literal `@robota-sdk/`.

The instance the investigation isolated is the clearest possible form of the problem — **both idioms
in one file**:

```js
// correctly reads config
if (dep.startsWith(HARNESS.npmScopePrefix) && ...)

// hardcoded, in the same file
const reexportPattern = /export\s+\*\s+from\s+['"](@robota-sdk\/[^'"]+)['"]/g;
```

`HARNESS.npmScopePrefix` is right there. Change the scope and that one rule silently stops matching —
**zero matches, reported as a pass**, which is HARNESS-064's vacuity arriving through a different
door.

This is not a new observation for this repo. `.agents/memory/harness-diet-audit.md` recorded it as
the audit's **top finding**:

> **Dominant finding: NON-NEUTRALITY** — Robota package names/paths/prose baked into machinery that
> presents as a general/portable harness (north-star violation).
> Fix pattern: move repo-specifics to config, keep the machinery generic.

The diet completed on 2026-07-24. This instance is still here on 2026-08-02, which is what makes it
worth a mechanism rather than another sweep: the sweep already happened.

It also has a downstream cost. The investigation was written by a consumer evaluating this harness
for adoption; residue like this is what they pay to port.

## Why this is foundational (or not)

**FOUNDATIONAL for the north-star, LOCAL as code.** Each literal is a one-line fix. What is
foundational is that a completed audit named this the dominant finding and it recurred — so the
answer is a check, not another pass over the files. The repo's own principle applies: a recurring
mistake is not closed by fixing the instance.

## Direction

A scan that finds the product scope literal in harness scripts **except where it arrives through
`harness-config`**. That shape is what catches the case above, where a correct use and a hardcoded
use sit in the same file — a file-level allowlist would not.

Two things to settle:

- The scan must know its own scope literal without hardcoding it, or it becomes an instance of what
  it checks. Reading it from the same config the scripts read is the obvious answer.
- Test fixtures and documentation examples legitimately contain the literal. Decide whether they are
  out of scope by path or need an explicit suppression, and prefer the narrower one.

## Test Plan

- **Required red-first regression:** a harness script with a hardcoded scope literal not routed
  through config must FAIL. Prove it fails before the scan is trusted.
- Red-first: the same script reading the literal from `harness-config` must PASS — otherwise the scan
  is a blanket ban and will be suppressed rather than obeyed.
- The scan must fail on itself if IT hardcodes the scope.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Does not apply.** No user-facing surface changes.

## Implementation

### The instance the audit isolated, and the one it did not

`check-dependency-direction.mjs:127` held the exact contrast the finding quotes — a hardcoded
`@robota-sdk\/` inside `reexportPattern`, four lines from `HARNESS.npmScopePrefix` used correctly.
It is now built from the configured scope, and red-proved: planting a pass-through re-export makes
the rebuilt pattern report it.

The audit named one file. Counting found **13 more**, and then the ratchet's own test found a
**second instance of the identical shape** in `check-test-module-mocks.mjs:56` —
`/vi\.mock\(\s*(['"])(@robota-sdk\/…)/`. Both are now composed from config.

`escapeForRegExp` moved from a private helper in `check-agent-server-boundary.mjs` to `shared.mjs`. A
second caller is when a private helper becomes a shared one rather than a copy.

### The mechanism, and the mistake it made first

`scan-harness-scope-literal.mjs` freezes the per-script count of the configured scope appearing in
CODE. Registered, classified fail-closed by execution (50 → 51 proven), and it reads its own scope
from the same config the scripts read — hardcoding it here would make the scan an instance of what it
checks. Verified: planting the literal in this scan makes it report ITSELF.

Comments are excluded deliberately, and this is the opposite call from the product-identity ratchet
made an hour earlier. There, prose WAS the coupling — a library docstring teaching the product's
layout. Here a rule that governs `@scope/foo` has to be able to name it while explaining itself, and
counting that would make the check unlandable and get it suppressed. Strings are not excluded: an
allowlist keyed by package name is code, and is exactly what should be composed from the prefix.

**The counter could not see the form it exists for.** Inside a regex literal the scope is written
`@robota-sdk\/`, and a substring test misses it — so the first version would have passed the very
instance that motivated the task. Its own test caught that. Once fixed, the true count was **88, not
77**: eleven occurrences across four more files had been invisible, and one of them was the second
audit-shaped instance above.

Red-proved four ways: a new hardcoded literal fails, a fall without re-freezing fails, this scan
hardcoding its own scope fails, and reading the scope from config passes — the last one because a
blanket ban would be suppressed rather than obeyed.

### Remaining

- 88 occurrences across 14 scripts are frozen, not removed. `check-agent-server-boundary.mjs` alone
  holds 38; most are package names in allowlists that should be composed from the prefix, and each is
  a one-line change the ratchet now makes visible.
- The scan counts a LITERAL, not coupling. A script that reads the scope from config and then assumes
  this repository's package layout scores zero and is no more portable. Falling to zero would be
  evidence, not proof.
