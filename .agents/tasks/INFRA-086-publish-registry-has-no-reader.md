---
title: 'INFRA-086: the publish registry authorizes five packages that do not exist, omits thirteen that are publishable, and no scan reads it'
status: todo
created: 2026-08-02
priority: high
urgency: soon
area: .agents/publish-registry.md, scripts/harness, packages (manifests)
depends_on: []
---

# INFRA-086: the publishing gate does not exist

## Problem

The document that is the **only** gate on what may be published under the org scope names five
phantom packages as beta-published, leaves thirteen real publishable packages outside itself, and has
**no mechanical floor at all** — nothing reads it. It has drifted in both directions until it
simultaneously under-authorizes real packages and authorizes imaginary ones.

This is supply-chain shaped: an authorization document with no reader is not a gate.

## Evidence

**Layer: CONFORMANCE** (the architecture↔implementation conformance audit). Four of its findings,
which the synthesis merged because together they say something none of them says alone.

- V3 — 13 publishable packages sit outside the registry that claims to gate publishing
  (`.agents/publish-registry.md:52`, `:6`): `agent-capability-pack`, `agent-process`, `agent-product`,
  `agent-provider-{anthropic,bytedance,defaults,gemini,openai,openai-compatible}`,
  `agent-remote-pairing`, `agent-transport-protocol`, `agent-transport-webrtc`, `pack-coding`.
  `grep -n "publish-registry" scripts/harness/*.mjs` returns **nothing** — the rule has no floor.
- P3 — `.agents/publish-registry.md:31-35` lists five `@robota-sdk/plugin-*` packages
  (`plugin-github`, `-jira`, `-linear`, `-notion`, `-slack`) as beta-published. None of the 86
  workspace manifests is named that.
- P2 — `:18` lists a consolidated `@robota-sdk/agent-provider` with subpaths; the repo's own SSOT
  (`.agents/project-structure.md:20`) says _"There is **NO** bare `agent-provider` package."_
- V4 — three packages the registry's Private table forbids publishing carry `"private": false`
  deliberately (`agent-executor`, `agent-interface-transport`, `agent-interface-tui`), and the
  registry lists `agent-executor` in _both_ tables (`:19` and `:41`).

The cause in one sentence, from the synthesis: _the publish gate is prose with no scan behind it, so
it drifted in both directions until it simultaneously under-authorizes real packages and authorizes
imaginary ones._

## Why this is foundational (or not)

**No FOUNDATIONAL/LOCAL verdict was issued.** CONFORMANCE uses a different axis — doc-side vs
code-side — and this entry is a **doc-side + code-side pair**: the registry is wrong (doc-side) _and_
three manifests deliberately contradict it (code-side).

The synthesis records that it **raised the severity above its sources**: V3 was rated `high` and P3
`medium` individually, and the synthesis ranks the merged entry HIGH because _the four findings
compose into "the publishing gate does not exist"_, which none of them says alone.

It also appears under theme T12 — _a document that claims to be an SSOT must be mechanically tied to
what it describes, or it will drift in both directions_ — where the synthesis notes
`.agents/publish-registry.md` is the case of a document **having no reader at all**.

## Direction

The invariant is T12's, quoted above. The synthesis's own framing implies the two halves:

1. **Reconcile the registry with the 86 workspace manifests** in both directions — add the 13
   publishable packages, remove the 5 phantom `@robota-sdk/plugin-*` entries, resolve the
   consolidated `@robota-sdk/agent-provider` entry against `.agents/project-structure.md:20`
   (_"There is NO bare `agent-provider` package"_), and resolve `agent-executor` appearing in both
   the Public and Private tables (`:19` and `:41`).
2. **Give it a reader.** `grep -n "publish-registry" scripts/harness/*.mjs` returns nothing today;
   without a scan the reconciliation is a one-time cleanup that will drift again.

The synthesis does not decide the V4 conflict's direction: three packages carry `"private": false`
_deliberately_ while the registry's Private table forbids publishing them. Either the registry or the
manifests is right, and that is a decision this Task must make explicitly rather than assume.

Risk named implicitly by the evidence: the registry is the _only_ gate, so tightening the manifests to
match a stale registry could un-publish packages that are legitimately published; the reconciliation
must be checked against what is actually on the registry-of-record (npm), not only against the
document.

## Test Plan

- **Required red-first regression:** a new harness scan that reads `.agents/publish-registry.md` and
  cross-checks it against every workspace manifest's name and `private` flag, failing on (a) a
  registry entry naming no workspace package, (b) a publishable workspace package absent from the
  registry, (c) a package listed in both tables, and (d) a `"private": false` manifest the registry's
  Private table forbids. Against the current tree this scan must FAIL on all four classes — 5 phantom
  entries, 13 missing packages, `agent-executor` in both tables, and 3 contradicting manifests. Write
  the scan and observe it red **before** correcting the registry.
- Register the scan in `run-all-scans` so it is a required check, and confirm it is reachable locally
  as well as in CI.
- Re-run after reconciliation and require green.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Not applicable.** This Task delivers a governance document reconciliation plus a harness scan. It
changes no runnable user-facing behavior — no CLI command, TUI action, browser flow or SDK surface
changes as a result. Per the Task README, a governance-only change must not invent a user execution
scenario; the mechanical verification (the scan going red before and green after) belongs in
`## Test Plan` above and is the gate for this item.
