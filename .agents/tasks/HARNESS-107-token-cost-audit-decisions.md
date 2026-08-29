---
title: 'HARNESS-107: harness token-cost audit — the decisions it raised, and their dispositions'
status: in-progress
created: 2026-08-09
priority: medium
urgency: soon
area: .agents/rules, AGENTS.md, scripts/harness, .claude/hooks
depends_on: []
---

# Harness audit — decisions open, work done

Measured 2026-08-09 from `~/.claude/projects/-home-ubuntu-dev-robota/*.jsonl` and from the tree.

**This is an open action item, not a reference document.** Everything under "Decisions" needs an
owner's answer; nothing there can be settled by reading the code.

**Moved here from `.agents/token-cost-report.md` on 2026-08-17 (D10).** It sat at the top of
`AGENTS.md` behind an "Open action" blockquote plus a row in the document table, so it cost
always-loaded context on every turn while it stayed open. `AGENTS.md` routes work items to
`.agents/tasks/`, and a document with a decision checklist is exactly that class — so it lives here
and `AGENTS.md` keeps no pointer at all. Delete this file when the checklist is clear.

## Disposition (owner decisions, 2026-08-17)

Recorded verbatim: _"D4,D8 빼고 나머지 모두 추천안 수용한다"_ — every recommendation below accepted
except D4 and D8, which stay open.

| Decision | Disposition                                                                                                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1       | **Accepted (a)** — enforce the size rule; slim the three documents and let the scan read its own document list from `operational.md`                                                                                                                                                            |
| D2       | **Accepted (a)** — `.prettierignore` + squeeze, after verifying `scan-mistake-mechanisms` reads the `**Mechanism:**` token rather than column geometry                                                                                                                                          |
| D3       | **Done** — the ask-first line was deleted; `git-branch.md` § Git Operations / Commit Cadence records why                                                                                                                                                                                        |
| D4       | **OPEN** — build-after-every-commit needs owner knowledge of the CI shape                                                                                                                                                                                                                       |
| D5       | **Done** — standing authorization written into `backlog-execution.md` § Agent Decision Authority, with the four carve-outs                                                                                                                                                                      |
| D6       | **Accepted** — hook-refusal card in `AGENTS.md`, sequenced after D1 funds the space                                                                                                                                                                                                             |
| D7       | **Accepted (a)** — `no-foreground-wait.sh`; ack variable and sleep budget decided at implementation                                                                                                                                                                                             |
| D8       | **OPEN** — skill descriptions and the unregistered-41 boundary are the skill owners' call                                                                                                                                                                                                       |
| D9       | **Done, one row inverted** — `ban-ts-comment` tightened to `error` (0 errors tree-wide); the 72-character subject rule was amended to the enforced 100 instead of tightening the config, because 43 of the last 100 subjects exceed 72 and GitHub appends 8 uncontrollable characters on squash |
| D10      | **Done** — this move                                                                                                                                                                                                                                                                            |

> **Counting note — read before re-measuring.** Claude Code writes **one JSONL record per content
> block**, and every block of one response carries an **identical copy** of `message.usage`. This
> session has 50,536 assistant records but only **26,068 distinct `message.id`** values (1.94
> records per turn), and none disagreed on usage. Summing per record overcounts by **1.93×**.
> Always deduplicate by `message.id`. Per-turn context is unaffected — it is a per-record field.

## What was measured

| Metric                    | Value       |
| ------------------------- | ----------- |
| Real API turns            | **26,068**  |
| Session length            | 34.6 days   |
| Total input tokens        | **14.1 B**  |
| Output tokens             | 20.4 M      |
| Mean context **per turn** | **539,612** |
| Compaction events         | 70          |

Cost per turn is flat regardless of how long a request runs — a one-line question costs the same
per turn as a 600-turn run. With a 1 M window, compaction floors context at ~73 K and it refills to
~999 K before the next one; the mean across that sawtooth is ~540 K. **That is arithmetic, not a
usage habit.** Session start was 32,154 tokens, so fixed overhead is innocent.

Turn count is therefore the whole multiplier. Sampling 1,211 turns found **0 that issued more than
one tool call** — every Read, every grep, every Bash was its own full-price turn.

---

## Decisions

Each needs a call. Recommendations are marked, but the choice is the owner's.

### D1 — `AGENTS.md` is 194 % of the size its own rule sets

`operational.md:58` requires `AGENTS.md`, `.agents/rules/index.md` and `.agents/project-structure.md`
to stay under 80 lines. Measured: **155 / 103 / 370**. Three of three named documents in violation.
`scan-file-size.mjs:26` scopes to `packages` and `apps`, so nothing can see them.

This matters more than a style nit: `AGENTS.md` is one of only two files re-injected after each of
the 70 compactions. Every line is paid on all 26,068 turns.

- **(a) Enforce it.** Slim the three documents, then extend the size scan to read its own document
  list out of `operational.md:58` so the two cannot drift. Candidates for eviction from `AGENTS.md`:
  `:54-56` (product/self-hosting narrative → `VISION.md`), `:60-63` (toolchain versions, already in
  `package.json`/Volta), `:77-85` (eight `pnpm harness:*` invocations, contradicting `:72-73` which
  says commands live in `package.json`), `:145-155` (three `rg` commands the file itself says are
  already mechanized as `conflict-markers` — and `scan-conflict-markers.mjs:31` carries an allowlist
  entry that exists only to stop those copies tripping it).
- **(b) Amend the rule** to the size these documents actually need, and say why routing documents
  are exempt from their own target.
- Leaving both as they are is the one option with no defence: `index.md:22-24` says a rule believed
  wrong needs a filed item, and there is none.

**Recommended: (a).** The eviction list above is ~2,900 bytes of content that already has an owner
elsewhere, which is more than the 80-line gap.

### D2 — `common-mistakes.md` is 82 % whitespace, and a gate enforces it

187,367 bytes, of which **153,281 are prettier table-alignment padding**. Squeezed content is 34,119
bytes. The file is not in `.prettierignore`, and `format:check` is a CI stage — so the padding is
mechanically defended. `AGENTS.md:110-111` tells every agent to read this file before non-trivial
work, i.e. ~18 K tokens paid to receive ~8.5 K of instruction.

- **(a) Add it to `.prettierignore` and squeeze the tables.** `scan-mistake-mechanisms` reads the
  `**Mechanism:**` token, not column geometry — verify that parser first, then it is a pure win.
- **(b) Convert to heading-per-entry**, which removes the table geometry entirely and reads better
  at 83 rows.
- **(c) Accept the cost.**

**Recommended: (a)** now, **(b)** if the file keeps growing.

### D3 — Two rules contradict each other, six lines apart

`git-branch.md:79` — "No `git commit` or `git push` without explicit user approval."
`git-branch.md:85-92` — "Commit at appropriate logical boundaries **as work progresses**… never
defer committing until the context is nearly exhausted… deferring reads as stalling. (Owner
directive.)"

Both cannot hold in an autonomous run. The session shows the seam being hit from the cadence side:
the user asked why commits were deferred until the context limit. `:85` was added as the correction
and `:79` was never reconciled. `agent-conduct.md:99-100` outranks both, which makes `:79` a dead
letter that still reads as absolute.

**Decide which survives**, and delete the other rather than qualifying it.

### D4 — Build after every commit, or not

`verification.md:11` — "**After every commit that modifies `packages/*/src/`**, run `pnpm build`…
**Do NOT skip this step**."
`verification.md:33` — "…re-running the build by hand after it is wasted minutes."

Unconditional at `:11`, conditioned away at `:33`, neither citing the other, inside one document.
`.agents/tasks/completed/HARNESS-072-nothing-detects-a-contradiction-between-two-rules.md` is open for the
detection problem; this instance still needs an answer.

### D5 — A standing "keep going" authorization

The most repeated correction in the session — five utterances, plus two Stop-hook re-drives:
_"멈출건지 물어보지말고 계속 진행해"_, _"멈추지 말고 내가 멈추라고 할 때까지 계속 진행해"_.

This is **not** a missing rule. It is an unresolved contradiction: `spec-workflow.md:109-151`,
`backlog-execution.md:39-61` and `:398-421`, and `git-branch.md:79,302-304` all mandate stopping to
ask; `agent-conduct.md:57-60,99-100` and `backlog-execution.md:23-37` mandate deciding and acting.
Nothing covers a _standing_ authorization that spans many turns.

- **(a) Write the exception** in `backlog-execution.md` beside the stop conditions: a user
  instruction to proceed without further confirmation outranks the ask-gates for decisions inside
  agent authority, stands until revoked or the session ends, and still stops for the four decisions
  that are the user's alone (product direction, published contract, repository policy files,
  user-authored documents). Record in the work item that it was in force and what it covered.
- **(b) Keep asking** and accept that the correction recurs.

**Recommended: (a).** It also needs one line in D6's card, or a compaction will drop it.

### D6 — A hook-refusal card in `AGENTS.md`

200 blocked tool calls came from three hooks enforcing rules that live in a 33 KB file which is
never auto-loaded. The rules are correct and the hooks work; the agent simply did not have them in
context after a compaction.

Proposed: ~700 bytes in `AGENTS.md` listing the five most-blocked refusals in imperative form, with
reasoning left in `git-branch.md`.

The arithmetic: 700 bytes ≈ 180 tokens × 26,068 turns ≈ **4.7 M tokens**. One blocked turn costs
~540 K; 200 blocked turns ≈ **108 M**, before the retry turn each one causes. **A card that
prevents 10 % of the blocks pays for itself; at 50 % it returns 10×.**

This is the only place in the audit where adding prose to an always-loaded file is defensible, and
it only stays defensible if D1 funds it.

### D7 — A hook that refuses foreground waits

61 turns died to Bash timeouts, almost all foreground CI polling (`sleep 150; for n in …; do gh pr
checks …`). The shape persisted to the final day. `Monitor` was used 36 times against 17,702 Bash
calls. Verified: all four PreToolUse Bash guards exit 0 on the timing-out shape — nothing looks.

`operational.md` already has "A Wait Is Not Idle Time" and it was violated for 34 days, which is the
case for making it mechanical.

- **(a) Add `no-foreground-wait.sh`** — refuse a foreground call whose sleep budget exceeds ~60 s or
  that loops around `gh pr checks`/`gh run view`, naming the background/monitor path in the message,
  with an ack env var for the deliberate case.
- **(b) Rule only**, and accept that prose already failed once here.

**Recommended: (a).** Not built yet — it needs the ack-variable name and the sleep budget decided.

### D8 — Skill descriptions, and the other 41 skills

12 skills are now registered (see below). Their descriptions total **5,720 bytes**, and 9 of the 12
exceed 250 B — they carry a procedure summary and a policy statement after the trigger clause. The
budget is currently a **ratchet pinned at today's value**: it cannot grow, and it should be lowered
as descriptions are trimmed.

Trimming is a content change only the skill owners should make: the description is what decides
whether a skill fires, and a bad trim is the same failure in a new costume.

Also open: **41 skills remain unregistered.** The reasoning for the 12 was that the rest are either
dispatched only by a parent (registering them invites bypassing the parent's ordering), pointer
stubs with no behaviour, or reference documents that `Read` serves better. **Confirm or revise that
boundary.**

### D9 — Stated limits that are stricter than the configured ones

Small, long-standing, and each is one edit:

| Rule                                                | Configuration                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `git-branch.md:80` — commit subject max 72 chars    | `commitlint.config.js` never sets `header-max-length`; default is 100         |
| `code-quality.md:11` — `@ts-ignore` is "prohibited" | `.eslintrc.json:53` is `"warn"`; `package.json:24` passes no `--max-warnings` |

Either tighten the configuration or amend the rule. `HARNESS-070` is filed for the second; the first
has no filed item, which under `index.md:22-24` makes it simply mandatory and unenforced.

### D10 — This file's own placement

`AGENTS.md:7-10` carries an "Open action" blockquote pointing here, plus a row in the document
table. `AGENTS.md:43` routes tasks to `.agents/tasks/README.md`, so a task with a checklist is the
one document class `AGENTS.md` explicitly delegates — and it costs always-loaded context on every
turn until someone deletes it.

Move it to `.agents/tasks/`, or accept the cost while it is open. **Recommended: move it**, and keep
only a one-line pointer if a pointer is wanted at all.

---

## Done

Landed and verified in this pass. Full harness green afterwards: **159 test files, 2,751 tests.**

- **Global default model moved off the 1 M context variant.** `~/.claude/settings.json` had
  `"model": "opus[1m]"` as the default for every project; now `"opus"`. Backup kept beside it.
  Changing nothing else, this is the largest single reduction available — a 200 K window caps
  per-turn cost at roughly a third of a 1 M one.
- **Skill layer repaired and locked.** `.claude/skills/` held 5 symlinks, **3 of them dangling**, and
  the 2 that resolved were vendored Vercel/React skills unrelated to this repo. 53 project skills
  were unreachable, so every project-skill invocation in 34.6 days failed — including
  `lesson-to-harness` (6/6), which `learning-loop.md:8` names as _the_ procedure for turning a
  repeated lesson into an enforced rule. Twelve are now registered, each declaring `invocable: true`
  in its own frontmatter, cross-checked by `scan-skill-registration.mjs`.
- **`scan-named-mechanism-resolves.mjs`** — a document that names a mechanism as required must name
  one that exists. Found `verification.md:17` requiring Playwright MCP as "non-negotiable" with no
  MCP server configured anywhere. That rule now states the outcome and the evidence rather than a
  tool identity, and says plainly that a missing driver is an unverified change, not an exemption.
- **`scan-hook-syntax.mjs`** — a hook that no longer parses exits 127, which the hook protocol
  treats as PASS. Four outages in late July took all four PreToolUse Bash guards offline at once.
  Covers `lib/`, which registration floors deliberately exclude and which has the widest blast
  radius.
- **`branch-guard.sh` no longer restates policy.** Its message contradicted `git-branch.md:162,165`
  on both who may delete a merged branch and which flag to use — the likely reason a prohibited
  command was retried 93 times. It now prints the corrected command and points at the single owner.
  The second `-D` recommendation is gone; no hook recommends `-D` any more.
- Removed the empty `.agents/rules/rules/`.

Not committed: `fix/core-027-*` was unmerged, and One-Branch-At-A-Time forbids cutting another
branch while it stands.

## Checklist

- [x] Default model off the 1 M context variant
- [x] Skill registry repaired; registration, declaration, ordering and description budget enforced
- [x] Named-mechanism floor; `verification.md` browser rule restated as an outcome
- [x] Hook syntax floor, including `lib/`
- [x] `branch-guard` message stops restating policy
- [ ] D1–D10 answered
- [ ] Behavioural rules written into `.agents/rules/operational.md` — issue independent tool calls
      together (0 of 1,211 sampled turns used more than one); chain consecutive same-directory Bash
      commands (73 % of adjacent pairs share a `cd` target); plan a file's edits before the first
      one (49 edits to one document, 34 reads of one file)
- [ ] One session per work item — do not carry a session for weeks
- [ ] Re-measure after one week and record the new per-turn context here

## Known drivers not yet addressed

- **A formatter hook invalidates the agent's copy of every file it edits.** `post-tool-format.sh`
  runs `prettier --write` on PostToolUse, so an Edit's own anchor is stale the instant it lands.
  This is the mechanical cause of 12 × "modified since read", 13 × "string to replace not found",
  and the defensive re-reads behind the 34-read file. The two worst-thrashed files are markdown,
  which prettier reflows most aggressively.
- **Editing migrated out of the Edit tool into Bash.** By the final slice, 98 of 462 Bash calls were
  `python3` string-replace scripts and 46 were `sed -i`, while Edit and Read had fallen to 1 call
  each. A `str.replace(a, b, 1)` that matches nothing exits 0 and rewrites the file unchanged — a
  failed edit reported as success, and uncountable.
- **~300 ms of hook latency on every Bash call** (four guards, each sourcing the same 52 KB
  tokenizer) ≈ 90 minutes across 17,702 calls. A literal `grep -qF` fast-path before `source` would
  remove most of it without changing a verdict.
- **`revert-detect.sh` slurps the whole transcript on every Stop** (`jq -rs`, 3,005 Stops, a
  transcript that reached 400 MB). Bounding the read to a tail window gives the same signal at
  constant cost.

## How to re-measure

Parse `~/.claude/projects/-home-ubuntu-dev-robota/*.jsonl`. Each `type: "assistant"` record carries
`message.usage` with `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
`output_tokens`. Context per turn is the sum of the three input fields. **Deduplicate by
`message.id` before summing** — see the counting note above.
