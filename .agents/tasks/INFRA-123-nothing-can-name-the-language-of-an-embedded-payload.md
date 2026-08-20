---
title: 'INFRA-123: nothing can name the language of an embedded payload, so a language-scoped rule has no reachable subject'
status: todo
created: 2026-08-20
priority: medium
urgency: next
area: scripts/harness
issue: 'https://github.com/woojubb/robota/issues/1919'
depends_on: []
---

# INFRA-123: the unit that has a language is the payload, and neither enforcer can name one

## Objective

`from glob import glob; glob(…)` and `import glob as g; g.glob(…)` are the symlink-following
enumerator wearing an import the call site does not spell. Reading that import requires knowing
**whose language a line is written in**, and neither half of this rule can answer it for the place
python actually lives here — inside a payload.

## Why the two available subjects both miss

- **The hook cannot attribute to an interpreter.** Every reader it has EXPANDS an interpreter
  payload, so once `python3 -c "…"` is expanded the payload's own `;`, `|` and `&` are
  indistinguishable from the shell's. `hook_statement_ranges` splits inside a payload for the same
  reason. Three cuts were measured and each refused a correct command: a whole-command conjunction, a
  nearest-interpreter walk with a hand-written reset list, and a separator reset.
- **The scan can only attribute to a FILE.** Scoped to a file that IS python, the rule judges an
  empty population here — measured on this tree: **zero** tracked `.py` files and **zero**
  python-shebang files, against **14** files containing `python3 -c`, every one of them `.sh`,
  `.mjs`, `.md` or `.yml` (counted on this change's own head; the figure moves as files are added,
  the two zeroes are the load-bearing halves). The rule would enforce nothing while the rule table said it did.
  Unscoped, it reports `import glob from 'glob'` — a package this repository depends on that does not
  follow — which is refusing the safe sibling.

The unit with a language is neither the command nor the file: it is the **payload** — a `-c`
argument, a heredoc body, a workflow `run:` block. Nothing in either enforcer can name one.

## What was done instead

The import widening was withdrawn rather than shipped unenforced. The follow-up to pull request #1886
keeps the call spelling, which needs no subject, and its rule table says so.

## Completion criteria

- [ ] TC-1: a reader can name the language of an embedded payload — its interpreter and its extent —
      without that extent being destroyed by expansion.
- [ ] TC-2: the import spelling is judged inside a `python -c` payload and a heredoc body, in a file
      of any type.
- [ ] TC-3: `import glob from 'glob'` in JavaScript, at the command and in a committed file, is not
      reported.
- [ ] TC-4: the hook and the scan agree on every case in the table above.

## Notes

Filed from the fifth review round of the follow-up to pull request #1886, where four of five commits
re-answered "whose language is this?" and each answer was measured wrong in a different direction.
Related: [INFRA-109](INFRA-109-flag-attribution-has-two-implementations.md), which owns the
command-side half of the same missing reader.
