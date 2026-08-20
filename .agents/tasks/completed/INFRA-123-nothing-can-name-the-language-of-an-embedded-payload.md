---
title: 'INFRA-123: nothing can name the language of an embedded payload, so a language-scoped rule has no reachable subject'
status: done
completed: 2026-08-21
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

- [x] TC-1: a reader can name the language of an embedded payload — its interpreter and its extent —
      without that extent being destroyed by expansion.
      `hook_interpreter_payloads` in `.claude/hooks/lib/command-scan.sh`. The masker already had to
      decide a quoted string was CODE — that is what `kind[sp] = "TOK"` means — and then threw the
      boundary away. Recording it costs two assignments at the open and one at the close.
- [x] TC-2: the import spelling is judged inside a `python -c` payload and a heredoc body, in a file
      of any type. Three payload sources: the FILE when the file IS that language, a HEREDOC body
      (which the hook is blind to by design), and a `-c` argument. See the limit below for what "any
      type" does NOT reach.
- [x] TC-3: `import glob from 'glob'` in JavaScript, at the command and in a committed file, is not
      reported.
- [x] TC-4: the hook and the scan agree on every case in the table above.
      `scripts/harness/__tests__/payload-language.one-owner.test.mjs`, 35 cases.

## Limit, stated rather than discovered

A payload embedded in a NON-shell file is not read — a `run:` block in a workflow, an `execSync`
argument in a `.mjs`. Naming those needs the language of a payload inside ANOTHER language's syntax,
and this reader gets its boundaries from shell grammar alone. It is the same boundary INFRA-109
records for its fallback pattern, and it is stated in both places rather than found once.

A HEREDOC at the COMMAND is likewise not reported: the masker treats the body as quoted content and
never opens a payload for it. In a committed FILE the body is ordinary text, which the scan reads —
so the two enforcers cover for each other rather than both being blind.

## Notes

Filed from the fifth review round of the follow-up to pull request #1886, where four of five commits
re-answered "whose language is this?" and each answer was measured wrong in a different direction.
Related: [INFRA-109](completed/INFRA-109-flag-attribution-has-two-implementations.md), which owns the
command-side half of the same missing reader.

## Progress

### 2026-08-21

Closed. The import widening this item withdrew can now ship, because the subject it needed exists.

**TC-1 was the whole item, and the information was already there.** The tokenizer marks an
interpreter payload `TOK` at its opening quote — that decision is what makes `python3 -c "…"`
readable at all — and then discards the boundary. `hook_interpreter_payloads` records it.

**One defect found while building it.** The recording was first placed at the `fend[sp] == c` site in
the quote handler, which produced ZERO payloads. That site closes a region about to be OPENED; the
one that closes a payload being READ is in the `k == "TOK"` branch a screen earlier. Two sites, one
condition spelled the same way — found by printing the count rather than by reading the code.

**One defect found in this change's own case table.** The row labelled "JAVASCRIPT, the same TEXT"
used `import glob from 'glob'`, and removing the language check entirely left it GREEN — because the
python patterns simply do not match that text. It passed for pattern precision, not for scoping, and
so proved nothing about the thing it was named for. A second row now carries text that matches the
python alias pattern EXACTLY inside a JavaScript payload; that row fails the moment the language
check goes, and the original is kept and relabelled as the real-world case it is.

Red-proofed one at a time:

| mutation                                | fails                                              |
| --------------------------------------- | -------------------------------------------------- |
| the payload extent stops being recorded | 8 — every python row, in both enforcers            |
| the language check removed              | 3 — the JS-carrying-python-text row and two decoys |
| heredoc bodies stop being read          | exactly 1                                          |

`npx vitest run scripts/harness/__tests__/` — 226 files, 4318 tests, all passed.
`pnpm harness:scan` — 129 passed, 2 skipped.
