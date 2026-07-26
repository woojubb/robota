---
title: 'INFRA-063: the release sweep calls itself FULL and walks past five workspaces — one of which has a suite'
status: todo
created: 2026-07-26
priority: medium
urgency: soon
area: package.json, .github/required-status-checks.json, scripts/harness
depends_on: []
---

# INFRA-063 — the release sweep is not the FULL sweep it is declared as

Filed out of INFRA-060 **D7**, split from it deliberately. D5 (the `security audit` →
`dependency audit` rename) and D7 look like the same over-claim, and the first thing this item
records is that **they are not the same shape and must not get the same fix.**

## Why this is not a rename

D5's over-claim lived in the **required-context NAME**, which is the string branch protection
matches on — so correcting it was a ruleset change with a merge-window hazard, and the behaviour
underneath was already correct.

D7's over-claim is not in a context name. `release-grade verification` does not itself claim to be
full. The word **FULL** appears in the DECLARATION PROSE:

- `.github/required-status-checks.json` → `branches.develop.deliberately_not_required` →
  "`release-grade verification` subsumes them: it runs the FULL build and the **FULL
  scan/test/typecheck/lint sweep**"
- `.github/required-status-checks.json` → `branches.main` → `release-grade verification` →
  "full build, full scan suite, harness suite, **package tests**, binary e2e, typecheck, lint"

So **no ruleset change is required to fix D7**, and it carries none of D5's hazard. That is the
whole reason it can be worked at any time rather than against an empty PR queue.

## The measurement

```
$ node -e "console.log(require('./package.json').scripts['harness:verify:release'])"
pnpm build:deps && pnpm harness:scan && pnpm harness:test && pnpm test
  && pnpm --filter @robota-sdk/agent-cli test:bin && pnpm typecheck && pnpm lint

$ node -e "console.log(require('./package.json').scripts.test)"
pnpm run -r --if-present test
```

`--if-present` walks past every workspace with no `test` script, silently. Measured — five
workspaces, with their source counts and what they DO declare:

| Workspace                | `test`? | Other suite      | Source files | Test files |
| ------------------------ | ------- | ---------------- | ------------ | ---------- |
| `packages/agent-cli-web` | no      | **`test:e2e`** ✱ | 2            | 0          |
| `apps/docs`              | no      | —                | 27           | 0          |
| `apps/www`               | no      | —                | 20           | 0          |
| `apps/blog`              | no      | —                | 9            | 0          |
| `apps/starter-nextjs`    | no      | —                | 3            | 0          |

✱ **This is the real finding, and it is a coverage gap rather than a wording one.**
`packages/agent-cli-web` declares a `test:e2e` script. `pnpm run -r --if-present test` matches the
script named exactly `test`, so `test:e2e` is never invoked by the release gate — a suite that
exists, is maintained, and is not run on a promotion.

It is also a gap the repository has already recognised once and closed by hand for a different
package: `harness:verify:release` explicitly appends
`pnpm --filter @robota-sdk/agent-cli test:bin`, a suite under a non-`test` name that had to be named
individually to be run at all. `agent-cli-web`'s `test:e2e` is the identical case, and simply was
not added.

The other four are private Astro/Next/Docusaurus site workspaces with genuinely no suite to run.
They are not uncovered — the same release command runs `pnpm typecheck` and `pnpm lint` over them —
but `pnpm test` legitimately has nothing to execute there.

## Nothing guards the absence

`scripts/harness/check-test-coverage-scripts.mjs` exempts a workspace from the coverage requirement
by the absence of the very script the requirement is about:

```js
export function isCoverageScriptRequired(scope) {
  const testScript = scope.scripts?.test;
  if (typeof testScript !== 'string') {
    return false; // no `test` script → nothing required
  }
  return /\b(vitest|jest)\b/.test(testScript);
}
```

A workspace that never grows a `test` script is therefore permanently and silently exempt, and a
workspace that puts its suite under any other name (`test:e2e`, `test:bin`) is exempt too. So the
class is not five workspaces — it is "any suite not named `test`", which is why a per-instance fix
is not enough on its own.

## What to do

1. **Run the suite that exists.** Add `agent-cli-web`'s `test:e2e` to `harness:verify:release` the
   way `agent-cli`'s `test:bin` already is — or, better, stop hand-maintaining that list.
2. **Enumerate rather than pattern-match.** A guard that lists every workspace-declared script
   matching `^test(:|$)` and asserts each is reachable from `harness:verify:release` would have
   caught both instances, and catches the next one. Prove it RED against the live defect (drop
   `test:bin` from the release script and require the guard to report it) before landing it.
3. **Correct the prose either way.** Whatever coverage lands, the two declaration strings above
   should state what the sweep actually spans. If four site workspaces are deliberately test-free,
   the declaration should say so — a named, reasoned exclusion is honest where "FULL" is not.
4. Decide, and record the number, whether the four site workspaces should be required to carry a
   suite at all. This item's position is no — but the position should be written down, because an
   unexamined absence is what produced this finding.

## Test Plan

- The new guard run RED against the reverted defect (release script with `test:bin` removed) and
  GREEN after — the guard must be falsified, not merely observed passing.
- `pnpm harness:scan`, `pnpm harness:test`, `pnpm harness:verify-like-ci` green.
- `pnpm harness:verify:release` executes `agent-cli-web`'s `test:e2e` — shown by its output, not
  inferred from the script text.

## User Execution Test Scenarios

Not applicable — a CI/verification-gate change delivers no runnable user-facing surface. The
evidence is the guard's red-then-green proof and the release sweep's own output.
