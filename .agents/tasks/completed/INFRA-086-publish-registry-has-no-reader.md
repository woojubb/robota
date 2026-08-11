---
title: 'INFRA-086: the publish registry authorizes five packages that do not exist, omits thirteen that are publishable, and no scan reads it'
status: done
completed: 2026-08-03
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

## Implementation

### Measured before anything changed

Every number in the finding held, checked by enumerating the manifests: 13 publishable packages
outside the registry, 6 names in it that are not workspace packages (the five `plugin-*` entries and
the bare `agent-provider`), `agent-executor` in both tables, and three Private-table entries shipping
publishable. **Including the 86 workspace manifests** — see the review round below, where I briefly
and wrongly disputed that one.

### The direction the graph decided, not taste

The three contradicting manifests (`agent-executor`, `agent-interface-transport`,
`agent-interface-tui`) were the one place the finding left a real choice: is the document wrong or are
the manifests? The dependency graph settles it. Each is a runtime dependency of packages this registry
authorizes — `agent-interface-transport` of **fourteen** of them. Marking them private would publish
fourteen installs that cannot resolve their own dependencies. The manifests were right.

That reasoning is not left in prose: it is rule 4 of the scan, so the next disagreement is decided the
same way rather than argued.

### The floor

`scripts/harness/scan-publish-registry.mjs`, registered in `run-all-scans` and classified in
`MANDATORY_TREE_GUARDS` by execution (47 → 48 proven fail-closed). Four rules, because each alone can
pass while the gate is still fiction:

1. **Coverage** — every publishable package appears in the Published table.
2. **Existence** — every name in the registry is a real package.
3. **Agreement** — Private entries carry `"private": true`, nothing is in both tables, Published
   entries carry `publishConfig.access: "public"`.
4. **Graph** — a Private package is not a dependency of a published one.

Red-proved end to end: against the pre-fix registry it reports **28** findings; against the corrected
one, zero.

**The scan caught its own parser first.** Its opening run reported five private packages as wrongly
published and missed every real disagreement, because the heading test asked for `published` before
`private` — and this repository's private heading reads "Private Packages (must NOT be published)".
A gate that mis-reads its own subject is worse than no gate; the ordering is now pinned by a case
quoting that exact heading.

### The document

Rewritten from the manifests: 31 published packages, the six phantoms gone, the three wrong Private
entries removed with the dependency-graph reasoning recorded in their place. The Private table is
explicitly _not_ an inventory — it records decisions someone might otherwise reverse by accident,
which is why rule 1 covers only publishable packages and a quiet private package needs no row.

### Review round 1 (PR #1609)

One MUST, and it lands on the worst thing in the change.

**The scan hardcoded `['packages', 'apps']` and read one directory level**, so the entire
`packages/dag-nodes/*` tier — its own glob in `pnpm-workspace.yaml`, twenty-two packages — was
invisible to every rule. A gate blind to a quarter of the workspace is not a gate for it: if one of
those ever shipped `private` unset with no registry entry, rule 1 would never have fired, and rule 4
could never have seen it as a dependency.

And the part that matters more than the bug: **I used that broken instrument to "correct" the audit.**
The finding said 86 manifests; my scan counted 66; I wrote in the task file and the PR description
that the audit's denominator was wrong. It was not. 86 is right, 66 was the artifact. This is the
third time this session I have cited a measurement taken with the wrong setup — the other two are in
`.agents/memory/claimed-without-reading-back.md` — and it is the most costly shape of it, because a
confident correction stops the next reader from re-checking the number I got wrong.

Discovery now reads the globs from `pnpm-workspace.yaml`, skipping the two tiers that are members but
never publish (`examples/*`, `scratch`) for the same reason `shared.mjs`'s `listWorkspaceScopes` does.
The live count is 86. Three cases pin it: the nested tier is found, `examples` is excluded, and the
number the scan reports must EQUAL an independent walk — the previous assertion was `examined > 30`,
which passed happily while a whole tier was missing.

The SHOULD — truncated Notes cells — came from generating the table with a `.slice(0, 84)` whose
output I never read. Regenerated from the manifests untruncated.

### Review round 2 (PR #1609)

One SHOULD, upheld, and the same shape as everything else this session: rule 4's docstring claimed
"a dependency of any published package" while the code read only `dependencies`. `peerDependencies`
and `optionalDependencies` are installed for a consumer too, so a private package added solely as a
peer dep would have slipped past the one rule whose entire purpose is to arbitrate that
disagreement. No false negative on today's tree — checked — but the claim was wider than the code,
which is the defect regardless of whether it has fired yet.

The code now matches the claim. `devDependencies` are deliberately excluded and a case pins that: a
consumer never installs them, so a private dev-only dependency is not a broken install, and counting
it would make the rule fire on ordinary internal tooling and get it suppressed.

### Remaining

- The registry's `npm tag` column is checked against nothing; the repository records nowhere what tag
  a package was actually published under. A pass says the document and the manifests agree, never
  that a publish is safe — stated in the scan's own limits.
- The Private table lists 5 of the 55 private packages by design (decisions, not an inventory), so it
  cannot be read as "the complete set of things that must not ship".
