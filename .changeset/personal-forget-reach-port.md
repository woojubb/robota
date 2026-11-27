---
'@robota-sdk/agent-product': minor
---

Forgetting in the personal wiki now hands what it removed to the host. `KnowledgeWiki` takes an optional `reach` port and a `forgetWithReport` method that collects every removed statement (current or retired, with its conversation) and the titles of deleted pages, cleans the pages and log, then calls the port; a port that throws is reported as `reachFailed` and never undoes the forget. A `{ claimIds }` target forgets several claims in one call, `ConnectorKeep` records the run a fact was read in, and `createForgottenTextRedactor`, `isSpecificText` and `FORGOTTEN_MARKER` give a host the matcher for its own copies. `WikiForget` answers with counts only and prefers the claim id.
