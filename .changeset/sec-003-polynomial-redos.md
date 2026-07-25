---
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-core': patch
---

Remove polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) from three parsers whose input is not repo-controlled.

`parseStructuredResponseText` (agent-core) parses raw model output; its fenced-code-block regex used `\s*\n`, and because `\s` also matches a newline the two overlapped, so an unterminated fence containing many blank lines was rejected in O(n^2) — 12.7s for a 400 KB string, now ~1ms. The whitespace run is now restricted to horizontal whitespace, which makes the newline split point unique.

`/schedule cron` and `/monitor` (agent-command) are declared `modelInvocable: true`, so their argument string is composed by the model. Both matched the trailing instruction with `\s+(.+)$`; since `.` also matches a space the split point was ambiguous and a non-matching argument cost O(n^2) — ~15s for a 200 KB argument, now <1ms. The instruction is now required to start with a non-space character, which pins the split point without changing which inputs are accepted.

No behaviour change: the set of accepted inputs and the parsed values are identical in every case.
