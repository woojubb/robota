---
'@robota-sdk/agent-tools': patch
---

`Glob` and `Grep` now bound file collection to a fixed candidate ceiling before materializing more
matches, instead of enumerating and `stat`-ing an entire search tree before any `limit`/`headLimit`
had a chance to apply. `Glob` streams `fast-glob` matches instead of resolving its full-match
promise form, and `Grep`'s directory walk stops once it has visited the ceiling's worth of entries.
Both tools state the truncation explicitly in their output when the ceiling is hit — `Glob`'s result
ordering (by modification time) then applies only to the candidates collected before the ceiling,
not to the full match set.
