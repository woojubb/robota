---
title: 'INFRA-047: migrate dependency-review deny-licenses → allow-licenses before the v6 bump'
status: in-progress
created: 2026-07-25
priority: low
urgency: later
area: .github/workflows/dependency-review.yml
depends_on: []
---

# INFRA-047: license-gate input migration

## Problem

`dependency-review-action` deprecates `deny-licenses` for possible removal in v6 (noted in-file when v5
landed, #1313). The deny list is LOAD-BEARING for the dual-license policy (blocks GPL/AGPL ingress).

## What

Build the equivalent `allow-licenses` list (inventory current dependency licenses; allow-list is stricter —
verify no currently-green license falls outside), switch inputs, delete the in-file deprecation note.
Gate: do NOT accept a Dependabot v6 bump before this lands.

## Test Plan

A test PR introducing a GPL dev-dep is BLOCKED under the new input (then closed).

Verify post-merge: the input swap itself landed via `ci/infra-047-allow-licenses` (allow-list =
verified lockfile inventory closure of 2026-07-25 + purl exemptions for the @robota-sdk dual-licensed
self-deps and the LGPL @img/sharp-libvips prebuilt family). The red-test above cannot run pre-merge —
dependency-review executes the config of the PR's MERGE result against the target branch, so the new
allow-list only gates PRs opened AFTER this lands. Run the GPL-fixture PR against develop after merge;
only then may this item be closed.
