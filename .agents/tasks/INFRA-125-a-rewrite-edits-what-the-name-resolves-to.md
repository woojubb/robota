---
title: 'INFRA-125: a bulk rename decides by spelling, and edits every same-named thing in the workspace'
status: in-progress
created: 2026-08-20
priority: medium
urgency: now
area: scripts/harness
depends_on: []
---

# INFRA-125: a rewrite site is where the name RESOLVES, not where it matches

## Objective

Issue #1887, split from issue #1884. A bulk rename greps for a symbol's spelling and rewrites every
site that matches, which is wrong whenever the name is not unique — and for ordinary names it is not.

## Measured, and still reproducing

A rewrite adding `await` to `createSession(` call sites edited three files that define their own
local helper of that name and import nothing from the package that changed. Verified on the current
tree before writing anything:

| file                                                                                          | local declaration | imports `createSession` |
| --------------------------------------------------------------------------------------------- | ----------------- | ----------------------- |
| `packages/agent-session/src/__tests__/session-compaction.test.ts`                             | 1                 | 0                       |
| `packages/agent-transport-mcp/src/__tests__/remote-command-admission.test.ts`                 | 1                 | 0                       |
| `packages/agent-framework/src/interactive/__tests__/interactive-session-host-actions.test.ts` | 1                 | 0                       |

All three were reverted before commit, and the reason they were caught was luck: the script printed
what it touched and the paths looked wrong for an unrelated reason.

I met the same three files from the other direction while fixing INFRA-119 — searching for unawaited
`createSession` calls returned them, and each had to be discarded by reading. That is the same manual
work this tool now does, done by hand, on the same names.

## Why issue #1884's fix does not cover it

That change bounds where a bulk edit can REACH. This is about whether the sites it reaches are the
right ones. A rewrite sourced correctly from `git ls-files`, staying inside `packages/*/src`, still
edits every unrelated spelling in the workspace — and produces no test failure when the local helper
happens to be compatible, only a silent semantic change.

Strictly worse than the failure issue #1884 closed: the store amplification announced itself in the
printed paths, and this does not announce itself at all.

## The three things issue #1887 asked to settle, answered

**1. Where the resolution happens.** Per candidate file, from its own bindings — not from a
TypeScript program built over the workspace. The accurate answer is the slow one, and reading each
file's imports and local declarations covers the measured failure (a local helper shadowing an
imported name) at a cost a rewrite can afford to pay per file.

**2. What the tool looks like.** `scripts/harness/resolve-rewrite-sites.mjs`, taking a symbol, the
module it is declared in, and the candidates; printing one verdict per file. Only `binds` may be
rewritten. Three distinct exclusions rather than one, because "same spelling, different thing"
happens three different ways and a reader deciding a borderline case needs to know which.

**3. Whether it is enforceable.** **It is not, mechanically, and the rule says so.** A hand-written
rewrite runs before any check can see it: there is no artefact to scan and no command shape a hook
can recognise, because the edit arrives as a finished diff. `Enforced by: nothing mechanical` is
written into the rule with that reasoning, which is the outcome issue #1887 named as acceptable —
silence was the alternative it refused.

## Limits, stated rather than mis-answered

A re-export chain, a namespace import used through an alias, and a symbol reaching a file through a
barrel under a different specifier are all unresolved. The namespace case is REPORTED
(`namespace-import-present-cannot-decide`, non-zero exit) rather than answered "no": `ns.createSession(...)`
is a real site, and skipping it silently would be the same silence as the name-based rewrite, in the
other direction.

## Plan

- [x] TC-01: a file declaring its own helper of that name is excluded.
- [x] TC-02: a local declaration excludes even when the symbol is ALSO imported.
- [x] TC-03: a file importing the symbol from the target module is admitted.
- [x] TC-04: importing that name from a different module is excluded, distinctly.
- [x] TC-05: a renamed import compares the LOCAL name, which is what a rewrite matches on.
- [x] TC-06: a type-only import still binds the name.
- [x] TC-07: a relative specifier resolves against the importing file, including an index landing.
- [x] TC-08: a namespace import of the target module reports "cannot decide" rather than "no".
- [x] TC-09: a namespace import of an UNRELATED module does not.
- [x] TC-10: the size is asserted exactly, and again after a second run.
- [x] TC-11: run against the three real files — all three `shadowed`, and the file that genuinely
      needed the edit `binds`.
- [x] TC-12: every verdict name in the code appears in the rule, checked mechanically.
- [ ] TC-13: `pnpm harness:pre-push` green.

## Test Plan

Fixture sources for the binding forms, and the three REAL files for the case that matters — a fixture
of a local helper would prove the fixture, and these three are the measured instance.

Red-proofed: removing the local-declaration exclusion fails exactly the two shadowing cases and
leaves the other eleven green. That is the whole defect, so it is the probe worth running.

## Progress

### 2026-08-20

Filed as issue #1887 from issue #1884's third item. The issue asks for three design questions to be
settled rather than answered after the fact, and the third — "whether this is enforceable at all" —
is answered `no`, in the rule, with the reason. A rule that claimed enforcement it does not have
would be the more comfortable and the less true option.
