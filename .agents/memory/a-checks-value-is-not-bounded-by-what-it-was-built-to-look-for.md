# A check's value is not bounded by what it was built to look for

A check is commissioned to catch one thing. What it actually catches is whatever is visible from
where it stands — and that is a larger set, because a check reads the real artifact while the author
reads the artifact they believe they wrote. **The gap between those two is where defects live, and
it is not a gap the author can close by looking harder.**

This matters at exactly one decision: whether to route around a check that is firing for a reason
you have already dismissed. The dismissal is usually correct about the finding and says nothing
about the trip.

## Three instances, one day

**A CodeQL alert made someone trace a path, and the trace found a different bug.** The alert was a
relocated pre-existing one — genuinely not introduced, correctly acknowledged. But answering it
required tracing every path from the parameter to the sink, and path 2 turned out to route a
filename read from a directory through a guard written for a caller-supplied id: one unusable
filename threw out of `list()` and took the resume picker with it. The sibling store had the
mirror-image bug, silently dropping the same file. Neither was what CodeQL was looking at.

**`scenario:verify` refused a push over a document the change had made false.** Not the change's
subject; a claim elsewhere that stopped being true.

**`affected-verify` caught a stale citation** in a set the author had already reviewed.

## The rule

- **A check firing for a reason you have dismissed is still a reason to look.** Answer it where it
  stands rather than routing around it; the answer is cheap and the trip is where the value is.
- **In all three the author's own sweep had already run and missed it.** A sweep tests the artifact
  you think you wrote. That is why "I already checked" is not an argument against a check.
- This is an argument against BYPASSING a check, not for adding more of them. A check nobody can
  answer gets bypassed, and then it catches nothing at all.

## Related

- [[a-scripted-edit-that-rebuilds-a-region-destroys-what-else-was-there]] — the same asymmetry from
  the other side: which tool happens to read a region decides how loudly a defect fails, and that is
  unrelated to how bad it is.
- `.agents/rules/enforcement-architecture.md` — silence is not success.
- Test files excluded from a package's typecheck are read by no tool at all — issue #2192.
