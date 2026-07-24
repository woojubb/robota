---
title: 'REL-022: managed release notes — categorized notes for GH releases + generated CHANGELOG sections'
status: done
created: 2026-07-24
completed: 2026-07-24
priority: high
urgency: now
area: scripts/release, .github/workflows, CHANGELOG.md
depends_on: []
---

# REL-022: Managed Release Notes

(Numbered REL-022 because REL-020 and REL-021 were already taken by completed items.)

## Problem

Owner request: "빌드/릴리스할 때 변경사항이 정리되어 릴리즈 노트에 적혀야 한다" — when we build/release,
the changes must be organized and written into the release notes.

Before this item, the two `v*` tag workflows (`release-bun-binaries.yml`, `release-desktop-app.yml`)
created the GitHub Release with `gh release create --generate-notes`, which dumps raw PR titles:
uncategorized noise including dozens of "Merge pull request #N from woojubb/develop" promotion
merges and internal chores, with no feature/fix/security separation. The root `CHANGELOG.md` was a
hand-written narrative with no per-release generated history.

## Decision

A single dependency-free generator, `scripts/release/generate-release-notes.mjs`, owns
GH-release/product-level notes:

- Parses conventional-commit subjects (commitlint-enforced in this repo) with the squash-merge
  `(#PR)` suffix; pure functions (`parseConventional`, `groupCommits`, `renderNotes`,
  `updateChangelog`) are exported and unit-tested; git access is confined to the CLI layer; no
  network.
- Groups: 🚀 Features (feat), 🐛 Fixes (fix), ⚡ Performance (perf), 🔒 Security (fix/chore with
  `deps`/`security` scope or advisory/vulnerability/OSV/CVE subjects), and a collapsed
  `<details>` 🏗 Internal section (chore/refactor/docs/ci/test/build/style + unparseable
  subjects). Excluded: merge commits, `release:` promotion commits, and dependabot-style duplicate
  subjects (dedupe keeps the newest).
- Each line renders the subject with a PR link; the section header carries the date and a
  `compare/<prev>...<tag>` link.
- `--notes-file` writes the section body for `gh release create --notes-file`;
  `--write-changelog` idempotently inserts/replaces marker-delimited generated sections in root
  `CHANGELOG.md` (hand-written content below is preserved).
- Previous-tag auto-detection: nearest `v*` tag reachable from `<ref>^`, falling back to the
  newest `v*` tag by creation date — required because historical tags (e.g. `v3.0.0-beta.24`) are
  NOT ancestors of the current line, so a bare `git describe` fails on real history.
- Both tag workflows generate a notes file with the script and pass it to the unchanged
  first-creator-wins race guard (`gh release view || gh release create ... --notes-file`).
- The release runbook (`.agents/rules/publish.md`, Release State Machine step 6) regenerates the
  `Unreleased` changelog section in every version-bump PR.

**Changesets boundary (explicit):** the 74 dormant `.changeset/*.md` files are npm-package-level
version-bump declarations consumed by `pnpm run version` and are intentionally untouched.
GH-release/product notes (this item) are complementary to — not a replacement for — the
changesets flow.

## Prior Art

Product documentation only (no third-party source code was read):

- **conventional-changelog / conventional commits** (<https://github.com/conventional-changelog/conventional-changelog#readme>,
  <https://www.conventionalcommits.org/en/v1.0.0/>): the `type(scope)!: subject` grammar this
  generator parses, and the standard practice of generating grouped changelog sections
  (Features/Bug Fixes/Performance) directly from commit history with compare links.
- **release-please docs** (<https://github.com/googleapis/release-please#readme>): maintains a
  generated `CHANGELOG.md` plus GitHub Release notes from conventional commits; its
  "sections per commit type, hide internal types" model is what the collapsed Internal section
  mirrors.
- **changesets changelog docs** (<https://github.com/changesets/changesets/blob/main/docs/modifying-changelog-format.md>):
  changesets owns package-level changelogs from `.changeset/*.md` intent files — confirming the
  repo's existing changesets flow addresses npm versioning, not product/GH-release notes, so the
  two systems are complementary rather than overlapping.

## Test Plan

- Unit tests (`scripts/release/__tests__/generate-release-notes.test.mjs`, root vitest include
  covers `scripts/**/__tests__`): parsing (scoped/unscoped, breaking `!`, PR suffix, merge/
  non-conventional rejection), grouping (security classification incl. plain-fix negative case,
  merge/release exclusion, dependabot dedupe, internal routing), rendering (group order, PR/compare
  links, `<details>` Internal, empty-group omission, heading-level nesting), and idempotent
  changelog insert/replace/ordering. Written red-first (22 tests failed on missing module, then
  green).
- Workflow YAML validity: `python3 -c "yaml.safe_load(...)"` over both edited workflows.
- `node scripts/harness/run-all-scans.mjs` passes (incl. release-governance over the edited
  `publish.md`).

## User Execution Test Scenarios

1. **Preview notes for the latest released tag**
   - Command: `node scripts/release/generate-release-notes.mjs --tag v3.0.0-beta.79`
   - Expected: markdown starting `## v3.0.0-beta.79 (2026-07-14)` with a
     `compare/v3.0.0-beta.24...v3.0.0-beta.79` link, grouped 🚀/🐛/⚡/🔒 sections with PR links,
     and a collapsed 🏗 Internal `<details>` block; no merge/`release:` lines.
   - Evidence: agent-run 2026-07-24 — output as expected (excerpt in PR body); rerun piped to
     `wc -l` → 2794 lines covering the 3553-commit range.
2. **Regenerate the changelog and verify idempotency**
   - Command: run `node scripts/release/generate-release-notes.mjs --write-changelog` twice; diff
     the file between runs.
   - Expected: `CHANGELOG.md` gains/refreshes the marker-delimited `## Unreleased` section above
     the generated tag section and the pre-existing hand-written narrative; the second run is a
     byte-identical no-op.
   - Evidence: agent-run 2026-07-24 — `diff` after the second run reported no changes
     (IDEMPOTENT-OK); one `generated-release-notes:start unreleased` marker present.
3. **Release workflow uses the generated notes** (runs on the next `v*` tag push)
   - Steps: push the next release tag; open the created GitHub Release.
   - Expected: the Release body shows the categorized sections instead of the raw PR-title dump.
   - Evidence: workflow wiring verified in this item (YAML valid, create line uses
     `--notes-file`, race guard unchanged); the live release body is observable on the next tag —
     the generator itself was executed against real history in scenarios 1–2.
