---
'@robota-sdk/agent-product': patch
---

The personal pack gains cases: the agent's own record of one matter it noticed, with its notes, at most one question it is waiting on, and its history. `CaseBook` keeps them behind a store port (file and memory), opens one case per source, and posts the question to the feed as a new `question` item kind carrying the notes as its evidence. The person's answer, one of the offered choices or a reply the question allows, is recorded on the case once; nothing runs on an answer. `CaseOpen`, `CaseNote`, `CaseAsk` and `CaseClose` are the agent's tools; they change only the agent's own record and the feed, so a read-only run and a connector sync run may use them (`syncRunTools` names them).
