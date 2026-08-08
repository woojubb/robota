---
title: 'HARNESS-080: the shared EXTENSIONS list bounds what every artifact check can see'
status: todo
created: 2026-08-08
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
related: [HARNESS-078, HARNESS-079]
---

# HARNESS-080 — the shared `EXTENSIONS` list bounds what every artifact check can see

## The problem

`scripts/harness/lib/file-name-shape.mjs` owns `EXTENSIONS = ['mjs', 'cjs', 'js', 'ts', 'tsx',
'md', 'sh', 'yml', 'yaml', 'json']`, and two checks read it:

- `commit-message-claims.mjs` — a SLASHLESS token needs a known extension to count as a path claim
- `scan-named-artifact-resolves.mjs` — same shape decides what counts as a named artifact

So a document or commit message naming a nonexistent `styles.css`, `index.html`, `config.toml` or
`pnpm-lock.lock` goes completely unchecked — the "artifact that is not there" class those checks
exist to close, silently out of scope for every extension the list does not carry. Review raised it
on PR #1647.

## Why it was not widened in place

Widening `EXTENSIONS` widens BOTH consumers at once: every slashless token with a newly-admitted
extension becomes a claim that must resolve, across 482 governed documents and every future commit
message. That is a corpus sweep with a false-refusal budget (illustrative names in docs, fixture
names in tests), not a list edit — the same reason `scan-new-rule-declares-enforcement` was not
widened in PR #1647 (HARNESS-079) and single-segment dotfiles were filed rather than admitted
(HARNESS-078).

## What done looks like

1. Measure: for each candidate extension, count what the widened reading would flag across the
   governed corpus and recent commit history.
2. Admit the extensions whose sweep comes back clean (or clean after repairs) in one change each,
   with the repairs.
3. For extensions that cannot be admitted (too many illustrative uses), record the exclusion and
   its reason beside the list, so the boundary is a decision rather than an accident.
