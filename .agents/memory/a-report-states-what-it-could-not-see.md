# A report states what it could not see

**Owner:** [`../rules/common-mistakes.md`](../rules/common-mistakes.md) entries 93 and 94. This file is
the session record behind them; the entries are the instruction.

One session produced five distinct ways a measurement came back confidently wrong, and three agents
working the same clone produced them independently within a few hours. The catalogue is in entry 93.
What is recorded here is the part that does not fit a table row: how each was caught, because in
every case the catch was the same act and it was never re-reasoning.

**Caught by counting the subject, not by reading the instrument.**

- A helper looked correct and removed nothing — a teardown hook registered from inside a running test
  is never collected. Every unit assertion about paths and prefixes passed while a run left 123
  directories behind. Counting `/tmp` before and after was the only thing that could tell the two
  states apart.
- A survey matching one spelling of a call reported 27% and missed every one of the five worst
  offenders, which used the other spelling. Counting both gave 54%.
- A registry file left reverted by a mutation experiment rode into the next commit and deleted a
  scan's registration. Two commits passed with the scan written, tested, classified, baselined and
  registered nowhere, and every local check stayed green because every local check reads the WORKING
  TREE. `pre-push` found it by refusing a dirty tree — and the dirty file was the CORRECT one.

**The fifth mechanism is the one with no better instrument.** Three sessions surveyed whether anyone
held a work item, by three methods, all three answers correct, all three missing a fourth session
that held it in an uncommitted tree. There is no query that returns unpushed work in another clone.
What made it a defect rather than a fact about distributed work is that the reports claimed the whole
population: _"no one is working on it"_ rather than _"no one visible is"_.

**So the single rule that covers all five is about the REPORT, not the instrument** — state what could
not be seen, or the number reads as coverage. It binds a scan's `::examined::` line, a survey's
denominator, and one agent answering another's ownership question, which is the case that had been
treated as ordinary conversation rather than as a measurement with a scope.

**Two habits worth keeping, both from peers.** Check a figure before repeating it — a number handed
over for one question was pasted as the answer to another and would have shipped under two names.
And say the entry number before writing it: two sessions appended to the rule catalogue concurrently,
the same ordinal was taken twice, and the second had to renumber. Announcing beats detecting.

Related: [[claimed-without-reading-back]], [[comment-asserted-invariants]].
