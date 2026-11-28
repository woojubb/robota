---
'@robota-sdk/agent-roundtable-robota': patch
---

`createFileRecoveryJournals(root)` keeps its files under a `recovery-journal` directory it creates inside `root` and makes only that directory owner-only; it no longer changes the mode of `root` itself, so a directory a host shares with other files is left as it was. A journal line whose entry lacks the fields its kind is read by is refused as damaged, on read and on append, instead of being accepted because its kind was recognised. A journal written by an earlier version sits directly under `root` and is no longer found there.
