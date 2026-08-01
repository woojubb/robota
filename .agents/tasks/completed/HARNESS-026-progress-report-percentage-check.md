---
title: 'HARNESS-026: enforce quantified progress-report percentage when a channel to observe agent reports exists'
status: done
created: 2026-07-11
completed: 2026-07-25
priority: low
urgency: later
area: scripts/harness, .claude/hooks
depends_on: []
---

# Enforce the quantified-progress-report rule mechanically

The **Quantified progress reporting** rule in
[`.agents/rules/agent-conduct.md`](../rules/agent-conduct.md) (Communication & Formatting) requires
that mid-work progress updates over a countable work set state a ratio **and** a percentage
(completed ÷ total). It was a prose rule with **no mechanical enforcement**.

## Why it was believed impossible (the recorded obstacle)

The item recorded that the harness "has no channel to observe or parse the agent's free-form
conversational output," so no scan or hook could assert that a progress report contained a
percentage.

**That premise was false.** The channel already existed and was already in use in this repo — see
the Outcome below.

## Outcome — MECHANIZED

`scripts/harness/scan-progress-report-quantification.mjs` (registered as
`progress-report-quantification` in `scripts/harness/run-all-scans.mjs`; policy under the
`progressReportQuantification` key of `.agents/harness.config.json`; fixtures in
`scripts/harness/__tests__/scan-progress-report-quantification.test.mjs`).

### The channel

Sessions are recorded as JSONL transcripts and hook payloads carry `transcript_path`. Two hooks
already read that channel and parse **assistant message text**:

- `.claude/hooks/correction-detect.sh` lines 48–67 — reads `.transcript_path`, selects records whose
  role is `assistant`, and flattens their content blocks to text.
- `.claude/hooks/revert-detect.sh` line 74 — the Stop-hook helper, same `transcript_path` input.

`scripts/harness/self-check.mjs` and `scripts/harness/__tests__/lessons-digest.test.mjs` already
build synthetic transcripts with a `transcript_path` payload, so the fixture pattern existed too.
An assistant record's `message.content[]` carries `text` blocks — the narrative stream itself.

### What the scan enforces (deliberately narrow)

Deciding whether an arbitrary sentence _is_ "a mid-work update over a countable set" is a semantic
judgment no regex can make, so the scan does not attempt it. It enforces the rule's operative
requirement — "report both the count and the percentage" — over the mechanically decidable case:

> a narrative line stating a **partial** completion ratio (`N/M`, `N < M`) in a completion context,
> with no percentage, is a violation.

Measured against a real multi-day session transcript, that form was the dominant real violation.
Suppressed false-positive classes (each covered by a fixture): completed results (`45/45 scans
pass`), identifier lists (`ARL-04/05/06/07`, `TC-01/04`, `1/2/3/5`), step/stage references
(`Step 4/5`, `8/9단계`), decimal scores (`7.7/10`), line references (`lines 54/146`), and ratios
inside code spans or fences. A bare unquantified "making progress" with no numbers remains
prose-governed — that residue needs the semantic judgment above.

### Where it runs

Only a host that actually ran sessions has the channel. With no transcript directory for the
workspace (CI, a fresh checkout, a worktree that never hosted a session) the scan prints an
explicit **skip with its reason** and exits 0 — never a silent pass. `enforceSinceIso` is a time
ratchet: past conversation cannot be edited, so only sessions from adoption onward are judged.

### Proof (lesson-to-harness step 9)

- Fixtures, red → green: `3/7 done` FAILS (1 finding); `3/7 done = 43%` PASSES (0). `main()` exits 1
  naming the rule, and exits 0 with the skip reason when the channel is absent. 26/26 tests pass.
- Real incident: run against the actual 288 MB session transcript it found **25 genuine historical
  violations** (e.g. `루트 정본 감사 완료 (1/5)`, `4/7 완료`, `8/10 tasks done`, `47/48 통과`) in
  1.05 s — the rule was really being broken, and the check really catches it. With the adoption
  cutoff applied the count is 0, so the scan lands green rather than red on unfixable history.
