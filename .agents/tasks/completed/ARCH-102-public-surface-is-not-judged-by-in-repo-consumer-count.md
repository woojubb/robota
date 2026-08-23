---
title: 'ARCH-102: a public surface is not judged by its in-repo consumer count'
issue: https://github.com/woojubb/robota/issues/2177
status: done
created: 2026-08-23
completed: 2026-08-23
priority: high
urgency: now
area: .agents/project-structure.md, .agents/skills/contract-disposition, .claude/agents, scripts/harness
depends_on: []
---

# ARCH-102: a public surface is not judged by its in-repo consumer count

## Problem

The owner gave a standing architectural instruction on 2026-08-23, after observing repeated attempts
to privatize or delete exported surfaces on the strength of how many places consume them:

> 공개된 인터페이스를 자꾸 한군데서만 쓴다거나 당장 안쓴다는 이유로 private로 바꾸려는 시도가 종종
> 보이는데 우리는 에이전트를 제작할수 있는 라이브러리를 지향하고 있으며 그렇게 제작해서 에이전트를
> 보유하고 있습니다. 누구나 이 라이브라리를 조합해서 그들만의 에이전트를 빌딩할 수 있어야 합니다.
> 한군데서만 쓰인다거나 지금은 안쓰인다라는 이유만으로 그걸 없애려고 하면 안되고 애초에 그게
> 필요없는것이거나 설계에 안맞을 경우에만 판단해서 private로 전환하거나 제거해야 하는 것입니다.

Two claims, and the second is the operative one. `packages/` is a library for composing agents —
anyone must be able to build their own agent from it, and this repository's own agent is one assembly
of it rather than the definition of it. Therefore **in-repo consumer count is not evidence about
whether a surface should be public, at any count.** The only grounds that support narrowing or
removing one are that it is genuinely unnecessary, or that it does not fit the design.

## Why the existing rule did not cover it

`.agents/project-structure.md` § Forward-Provisioned Surface Rule already said most of this — and said
it only about **zero**: _"A public surface in `packages/` with zero in-repo consumers is not dead
code."_ A surface with exactly one consumer fell outside its literal text, which is the case that
actually arose (issue #2177: `capability-contracts`, zero external consumers, one internal consumer).
The rule also stated what is NOT a reason without ever stating what IS, so a reader who accepted it
had no criterion left to apply and could only conclude "never narrow anything" — which is not the
instruction and would be wrong.

## Where the contradiction was mechanized

Four places carried the banned inference, and they are the reason the instruction kept being violated
by sessions that had read the rule:

1. `.claude/agents/architecture-design-auditor.md` criterion 3 asked, verbatim: **"Does every public
   symbol have a real consumer?"** That is the banned inference stated as an audit criterion. The same
   file's criterion 6 leans the other way ("Has a necessary boundary been deferred merely because there
   is only one present consumer?"), so the auditor contradicted itself within one document.
2. `.claude/agents/architecture-structure-auditor.md` criterion 4 told the auditor to compare exports
   against consumers without bounding what a low count licenses.
3. `.agents/skills/contract-disposition/SKILL.md` was framed entirely around "unconsumed" — correct as
   far as it went, silent on one consumer, and it cited the rule by a line number that this change
   moves.
4. `scripts/harness/check-orphan-exports.mjs` reported `"X is exported but referenced nowhere else in
the workspace"`. Its LOGIC is already correct — entry points, `package.json` export sources and
   barrel-re-exported modules are all skipped, so a `packages/` public surface is exempt by
   construction. Its MESSAGE says none of that, and a message is what an agent acts on.

Point 4 is measured, not hypothetical. On 2026-08-23 a session cleared nine of these findings by
unexporting the symbols. The outcome was right — they were internal helpers of one codec directory, so
"does not fit the design" applied — but the session reported plainly that it unexported them **because
a scan was red**, not because it had judged them internal. Had they been genuine composable surface,
the same red would have produced the same action on the ground the owner has now ruled out.

## Plan

- [x] Extend § Forward-Provisioned Surface Rule from "zero consumers" to any count, and state the two
      affirmative grounds that DO qualify.
- [x] Amend `architecture-design-auditor` criterion 3 and `architecture-structure-auditor` criterion 4.
- [x] Extend `contract-disposition` to the one-consumer case and repoint its rule citation.
- [x] Make `check-orphan-exports` say what it does not judge, in the finding text and the header.
- [x] Sweep for what the amended rule now contradicts, and record the result.

## Test Plan

- `pnpm harness:scan` green, including `orphan-exports` (whose message changed but whose logic did not),
  `document-standards`, `agent-def-convention`, `conflict-markers` and `reference-kind-qualified`.
- `node scripts/harness/check-orphan-exports.mjs` passes, confirming the message edit changed no verdict.
- Sweep result recorded in the paired spec-doc rather than asserted.

## User Execution Test Scenarios

Not applicable — rule text, two agent definitions, one skill and one scan's finding message. No
runnable user-facing product behaviour changes: no CLI command, TUI action, browser flow, or public
SDK surface. Per `.agents/tasks/README.md` a rule-only change records the not-applicable with its
reason rather than inventing a product scenario, and the checks belong in the Test Plan above.
