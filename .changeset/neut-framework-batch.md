---
'@robota-sdk/agent-framework': minor
---

Framework neutrality batch (NEUT-001/003/004/007): `planSelfHostingVerification` now requires injected
command templates (repo-process literals evicted from the library); built-in agent set, subagent prompt
suffix, and self-verification content are injectable; `claudeMd` renamed to `projectNotesMd` (breaking,
beta line); `.agents/tasks` context injection is now opt-in via `taskContext` settings and the unused
`updateTaskFileStatus` write API was removed; memory candidate-extractor trigger/vocabulary policy is
constructor-injectable with the previous bilingual/dev set as the documented default; session-name
sanitizer is Unicode-aware (non-Latin titles preserved).
