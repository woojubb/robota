---
title: 'REL-024: the changesets `fixed` group holds 13 packages while the version rule says every `@robota-sdk/*` package is in it — the next major bump splits the workspace into two version lines'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2475#issuecomment-5460392409
created: 2026-08-16
priority: high
urgency: before-next-publish
area: .changeset/, .agents/skills/version-management
depends_on: []
---

# REL-024: the fixed group and the version rule disagree

## Resolution

Returned to owner-decision issue #2475 on 2026-08-29. The scope remains valid, but selecting the
authoritative release policy requires an owner decision; no source, configuration, or policy change
is made in this document-only migration.

## Problem

`.agents/skills/version-management/SKILL.md` states two rules as invariants:

- rule 1 — "all `@robota-sdk/*` packages have the same version — no exceptions";
- rule 4 — "all packages are in the same `fixed` group in `.changeset/config.json`".

`.changeset/config.json` contains **13 packages**: `agent-cli`, `agent-command`, `agent-core`,
`agent-executor`, `agent-framework`, `agent-interface-transport`, `agent-interface-tui`, `agent-plugin`,
`agent-preset`, `agent-session`, `agent-subagent-runner`, `agent-tools`, `agent-transport`. The workspace
publishes roughly thirty. Every transport implementation is outside it —
`agent-transport-protocol`, `agent-transport-ws`, `agent-transport-webrtc`, `agent-transport-http`,
`agent-transport-tui`, `agent-transport-gui`, `agent-transport-webrtc-web` — as are the provider packages.

Today every package sits at `3.0.0-beta.79`, so the disagreement is invisible. It stops being invisible at
the next `changeset version`: there are already major changesets pending against the fixed group, which
takes those 13 to `4.0.0-beta.N` while an outside package moves only when it has a changeset of its own.
The workspace then holds two version lines, which rule 1 says cannot happen — and nothing fails when it
does, because no scan reads the config against the rule.

## Why this is filed rather than fixed in passing

Found while classifying the release impact of ARCH-030
(`.agents/tasks/completed/ARCH-030-outbound-protocol-replies-bypass-carrier-delivery-boundary.md`), whose changeset
classifies `agent-transport-protocol` as `major` and its two dependents as `patch`. That classification is
what the semver table forces once the config is taken as the operative artifact, and it is correct for that
item. The disagreement it exposes is monorepo-wide and pre-existing: ARCH-030 neither caused it nor is the
right place to resolve it, because resolving it changes what the NEXT release publishes for roughly
seventeen packages.

## What

Decide which of the two is authoritative, then make the other match, and add the mechanical floor that
would have caught the drift:

1. **If rule 4 is authoritative** — add every published `@robota-sdk/*` package to the `fixed` group, and
   accept that any package's major takes the whole workspace major. State the cost in the skill: an
   unrelated package's breaking change bumps every package a consumer has installed.
2. **If the current config is authoritative** — rewrite rules 1 and 4 to describe per-package versioning,
   and say how a consumer is expected to reason about mixed versions across `@robota-sdk/*`.

Either way: a scan that fails when a published workspace package is absent from the `fixed` group (option

1. or when the skill's prose claims a membership the config does not have (option 2). The drift survived
   because it is stated in prose in one file and configured in another, and nothing compares them.

## Test Plan

- The new scan fails on the current tree before the reconciliation and passes after it.
- `pnpm changeset version --snapshot` (or a dry run) shows one version line across every published package.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — this is a release-governance and configuration change that delivers no runnable
user-facing behavior. Verification evidence belongs in the Test Plan above.

## Plan

- [ ] Get the owner's decision between the two options (this is product/release policy, not agent authority).
- [ ] Apply the chosen reconciliation to `.changeset/config.json` and/or `version-management/SKILL.md`.
- [ ] Add the scan that compares the two and wire it into `run-all-scans`.
- [ ] Verify one version line across the workspace on a dry-run version bump.

## Blockers

- Needs an owner decision: which of the two rules holds. Both are defensible and the choice changes what
  every future release publishes.

## Result

Pending.
