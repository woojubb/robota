---
status: in-progress
type: INFRA
tags: [ci, release, distribution, automation]
---

# RELEASE-001: automate the binary/installer release off a version bump (npm stays OTP-manual)

## Problem

The DIST-002 / GUI-003 release workflows fire on a `v*` tag and attach the Bun binaries + OS installers to that
tag's GitHub Release — proven end-to-end (a test tag produced all 11 assets; `install.sh` installed from the real
Release). But **nothing pushes a `v<version>` tag automatically**: the owner must remember to push one by hand
after bumping the version. Goal (owner: "필요할 때 범프하면 바이너리까지 다 자동화"): when a version bump lands on
`main`, auto-push the matching `v<version>` tag so the binaries/installers build without a manual step.

**Explicitly NOT automating npm publish.** The repo deliberately uses an **OTP-gated manual npm publish**
(`.agents/rules/release-operations.md`, INFRA-029 single-OTP flow, enforced by `check-release-governance.mjs`).
Owner decision (2026-07-14): **automate binaries only; npm stays OTP-manual.** So this spec does NOT touch npm
publish, `release.yml`'s publish job, changesets publishing, or the release-governance policy — no conflict.

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

**A new `.github/workflows/release-tag-on-version-bump.yml` on `push: main` that detects an `agent-cli` version
bump (vs the parent commit) and, if the matching tag is absent, pushes `v<version>` using a repo-scoped DEPLOY KEY
— which fires the existing `v*` binary/desktop workflows. npm publish is untouched.**

- **Mirror-analog:** the release surface is already "independent `v*`-triggered sibling workflows" (DIST-002 /
  GUI-003, deliberately non-coupled). This adds one more sibling that only _pushes the tag_ — it does not package
  or publish anything, so the non-coupling holds.
- **`agent-cli` version is the correct source (reviewer #2).** The `fixed` changeset group covers 14 of ~29
  publishable packages; the others (providers, transports, `agent-process`, …) version independently — so
  `v<version>` is NOT an aggregate over all packages. It is the **agent-cli / desktop-app release tag**, and the
  binaries/installers ARE the compiled `agent-cli`, so reading `packages/agent-cli/package.json` is exactly right.
- **The `v*` trigger bridge (load-bearing).** GitHub does not start workflow runs from a tag pushed with the
  default `GITHUB_TOKEN` (anti-recursion — confirmed). So the tag must be pushed by an external credential. Use a
  **repo-scoped deploy key** (SSH, write) — strictly least-privilege (no user identity, single-repo, cannot be
  over-scoped) and it fires `v*` workflows. (A fine-grained PAT also works; the deploy key is preferred — reviewer #4.)
- **Owner controls timing:** the tag fires only when a **version-bump commit** lands on `main` — i.e. when the
  owner merges their version bump. Ordinary pushes are a no-op (version unchanged / tag already exists).

### Affected Scope

- **New:** `.github/workflows/release-tag-on-version-bump.yml`; a short RELEASE runbook doc.
- **Unchanged:** `release-bun-binaries.yml`, `release-desktop-app.yml` (still `v*`-triggered — the deploy-key push
  fires them); `release.yml` + the OTP-gated npm publish flow; `release-operations.md`; the governance scan.
- **Owner-provisioned:** a repo **deploy key** (write) whose private half is a secret (`RELEASE_DEPLOY_KEY`).

### Alternatives Considered

1. **Deploy-key push of `v<version>` on a version-bump commit (CHOSEN).** Minimal, npm-free, respects the OTP
   policy, keeps the binary/desktop workflows independent + still manually taggable, least-privilege credential.
2. **changesets/action full pipeline incl. npm publish.** REJECTED — automates npm publish with an automation
   token (no OTP), directly conflicting with `release-operations.md`'s OTP-gated policy + governance scan. (This
   was the prior draft; the owner chose binaries-only.)
3. **Fine-grained PAT instead of a deploy key.** Viable, but a user-bound PAT is broader than a repo-scoped deploy
   key; the deploy key is the more least-privilege bridge (reviewer #4). PAT kept as a documented fallback.
4. **Reusable `workflow_call` from a release orchestrator.** REJECTED — couples the three currently-independent
   workflows and moves Release-creation into an orchestrator; the tag bridge keeps them independent. (Note: a
   reusable workflow can keep `v*`/`workflow_dispatch` alongside `workflow_call` — the trade is coupling, not a
   lost entry — reviewer #6.)
5. **Manual `git push v<version>` (status quo).** Works today (proven) but is the manual step the owner wants gone.

### Architecture Review Checklist

- [x] New-surface placement surfaced FIRST + independently validated (proposal-review; scope narrowed to binaries).
- [x] Mirror-analog identified (independent `v*` sibling workflows) and non-coupling preserved.
- [x] The `GITHUB_TOKEN` no-trigger limitation is addressed explicitly (deploy-key push) — not assumed away.
- [x] Correct version source — `agent-cli` (the binary), NOT a false "aggregate over all packages"; guard an
      already-existing tag; fire only on an actual version-bump commit.
- [x] Least privilege — a repo-scoped write **deploy key**, not a user PAT; no npm token involved.
- [x] No conflict with `release-operations.md` — npm publish / OTP flow / governance scan are untouched.
- [x] Owner-gated timing — fires only when a version-bump commit lands on `main`.

### Decision

Add `release-tag-on-version-bump.yml` (`on: push: main`, `concurrency` per commit, deploy-key auth). On each main
push: `PREV` = the `agent-cli` version at `HEAD^`, `CUR` = at `HEAD`; if `CUR != PREV` (a bump just landed) and the
remote has no `v$CUR` tag → create `v$CUR` and push it via the deploy key → the `v*` binary/desktop workflows build

- attach binaries/installers to that Release. If the version is unchanged or the tag exists → no-op (idempotent).
  npm publish, OTP, and versioning policy are entirely untouched.

## Solution

- `release-tag-on-version-bump.yml`:
  - `on: push: { branches: [main] }`; `permissions: contents: read` (the push uses the deploy key, not
    `GITHUB_TOKEN`); `concurrency: { group: release-tag-${{ github.sha }} }`.
  - checkout with `fetch-depth: 2` (need `HEAD^`) and `ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}`.
  - a step: read `HEAD^` vs `HEAD` `agent-cli` version; if unchanged → exit 0 (log "no bump"). Else `TAG=v$CUR`;
    `git ls-remote --tags origin "$TAG"` non-empty → exit 0 (log "tag exists, skip"). Else `git tag "$TAG" &&
git push origin "refs/tags/$TAG"` (over the deploy-key SSH remote) → fires the `v*` workflows.
- RELEASE runbook doc: how a release now works (bump the version via the existing flow → merge → binaries auto-
  build; npm publish stays the existing OTP step), + how to create the repo **deploy key** (`ssh-keygen`, add the
  public half as a repo Deploy Key with write, the private half as `secrets.RELEASE_DEPLOY_KEY`).

## Affected Files

- NEW: `.github/workflows/release-tag-on-version-bump.yml`; a RELEASE runbook doc (e.g. `docs/releasing.md` or an
  addition to the existing release docs).

## Constraints / Non-goals

- **Requires an owner-provisioned deploy key** (`RELEASE_DEPLOY_KEY`). INERT until it exists — without it the tag
  push fails LOUDLY (not a silent partial release); the rest of main CI is unaffected.
- **npm publish is OUT OF SCOPE** — stays the OTP-gated manual flow (`release-operations.md` unchanged). Binaries
  and npm are independent release channels at the same version.
- Binaries release as soon as a version bump lands (may precede the owner's OTP npm publish) — acceptable; same
  version, independent channels.
- Out of scope: signing (unsigned per DIST-001/002/GUI-003), the binary/desktop workflows (DIST-002/GUI-003),
  automating versioning itself (the owner's existing bump flow is untouched).

## Completion Criteria

- TC-01: A commit to `main` that bumps `agent-cli`'s version (and has no existing `v<version>` tag) → the workflow
  pushes `v<version>`, which FIRES the binary + desktop workflows (proving the deploy-key anti-recursion bridge).
- TC-02: A commit that does NOT change `agent-cli`'s version → the workflow is a no-op (no tag pushed).
- TC-03: A version-bump commit whose `v<version>` tag ALREADY exists → no-op (idempotent; no duplicate/forced tag).
- TC-04: The tag push uses the DEPLOY KEY (not `GITHUB_TOKEN`); `permissions:` grants no more than needed; no npm
  token is referenced.
- TC-05: `actionlint` clean; `release.yml` / `release-bun-binaries.yml` / `release-desktop-app.yml` /
  `release-operations.md` / `check-release-governance.mjs` are byte-unchanged.
- TC-06: Absent `RELEASE_DEPLOY_KEY`, the push step fails loudly (surfaced), and no other main-CI job is affected.

## Test Plan

- **Agent-owned (local/static):** `actionlint`; a dry-run of the bump-detection + tag-name logic (simulate
  `HEAD^`/`HEAD` agent-cli versions → assert push-vs-skip for changed / unchanged / tag-exists); confirm the
  binary/desktop workflows + `release-operations.md` are unchanged (`git diff`).
- **CANNOT be fully agent-run** — the deploy-key push firing another workflow needs the real secret + a real
  version-bump commit on main; that is the GATE-COMPLETE User Execution Test (owner-run after provisioning the key).
  (The `v*`→binaries half is already proven by the test-tag run — 11 assets + `install.sh`.)

## User Execution Test Scenarios

**Scenario A — bump → binaries auto.** Prereq: `RELEASE_DEPLOY_KEY` set. Steps: land a version bump on `main`
(the existing flow) → observe: `v<version>` tag auto-created → binary/desktop workflows run → the Release lists the
5 binaries + `SHA256SUMS.txt` + 5 installers. npm publish is done separately via the OTP flow. Evidence: the
Release URL + the auto-created tag. _(fill after provisioning.)_

## Tasks

Deferred to GATE-IMPLEMENT. Preliminary: T1 `release-tag-on-version-bump.yml` + actionlint + local
bump-detection dry-run; T2 the RELEASE runbook + deploy-key setup doc; T3 feature→develop→main via merge-verifier;
T4 GATE-COMPLETE (owner provisions the deploy key + lands a version bump).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-14

Mechanical checks green (`check-spec-doc-frontmatter`, `check-backlog-placement`, `scan-test-plan`). All required
sections present with a Placement Decision first, ≥2 alternatives, 7-item checklist, TC-driven criteria, deferred
Tasks, Evidence Log. Status → `review-ready`; `draft/` → `backlog/`.

### [proposal-review] — 🔧 REVISE → scope narrowed + fixes applied | 2026-07-14

Independent `proposal-reviewer` confirmed the `GITHUB_TOKEN`-no-trigger premise (PAT/deploy-key genuinely required)
and endorsed the "independent `v*` sibling workflows" direction, but flagged: (1) the `fixed` group is 14/~29
packages — `v<version>` is the **agent-cli** tag, not an aggregate; (2) a **tag-derivation gap** — gate on an
actual `agent-cli` bump + guard an existing tag; (3) build-before-publish ordering; (4) a **deploy key** is more
least-privilege than a user PAT; (5) **the prior full-auto npm-publish design CONFLICTED with
`release-operations.md`'s OTP-gated policy + governance scan**; (6) the Alternative-2 rejection was mis-stated.

Owner decision (2026-07-14): **automate binaries only; keep npm OTP-manual.** The spec was **re-scoped**
accordingly — npm publish / changesets-publish / `release-operations.md` are entirely OUT (resolving #5 and the
build-before-publish concern: no publish here). Applied: version source = `agent-cli` with an existing-tag guard +
bump-only firing (#1/#2/TC-01..03); **deploy key** over PAT (#4); the Alternative-2 note corrected (#6). No
`changesets/action` PR-create setting needed (no versioning automation).

### [GATE-APPROVAL] — ✅ PASS | 2026-07-14

Owner delegated approval conditional on rule-conformance; owner explicitly chose the binaries-only scope. Rule
alignment: **no conflict with `release-operations.md`** (npm/OTP/governance untouched — the prior conflict is
designed out); mirror-analog to the independent `v*` sibling workflows with non-coupling preserved; least-privilege
(repo-scoped deploy key, no npm token); the `GITHUB_TOKEN` limitation addressed explicitly; fail-loud on a missing
secret; owner-gated timing (fires only on a version-bump commit). Residual: the deploy-key push firing another
workflow is verifiable only with the real secret — contained as GATE-COMPLETE (the `v*`→binaries half is already
proven by the test-tag run). Status → `approved`; `backlog/` → `todo/`. GATE-IMPLEMENT next.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-14

Task file `.agents/tasks/RELEASE-001.md` authored; status → `in-progress`; `todo/` → `active/`.

### [GATE-VERIFY] — ✅ PASS (agent-run, local) | 2026-07-14

Implemented `.github/workflows/release-tag-on-version-bump.yml` + a `.github/RELEASING-BINARIES.md` runbook (+
deploy-key setup). Verified:

- **TC-05:** `actionlint` clean; `release.yml` / `release-bun-binaries.yml` / `release-desktop-app.yml` /
  `release-operations.md` / `check-release-governance.mjs` byte-unchanged vs origin/main — **no npm/OTP/governance
  conflict** (the whole point of the re-scope).
- **TC-01/02/03 (bump-detection logic):** dry-ran the compare-HEAD^-vs-HEAD-agent-cli-version + existing-tag-guard
  logic — bumped+tag-missing → PUSH `v<version>`; unchanged → NO TAG; bumped+tag-exists → SKIP. All correct.
- **TC-04:** the push uses `secrets.RELEASE_DEPLOY_KEY` (checkout `ssh-key`), not `GITHUB_TOKEN`; `permissions:
contents: read`; no npm token referenced.
- **The `v*`→binaries half is already PROVEN end-to-end** (test-tag run: 11 assets attached; `install.sh` installed
  from the real Release). This workflow only adds the auto-push of that tag on a version bump.

Remaining: T3 feature→develop→main (merge-verifier); **T4 GATE-COMPLETE** = the User Execution Test — owner
provisions `RELEASE_DEPLOY_KEY`, lands a version bump on main, and confirms the tag auto-fires the binary release
(owner-gated: needs the secret + a real bump).
