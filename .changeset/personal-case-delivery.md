---
'@robota-sdk/agent-product': patch
---

A case question now carries an urgency the agent only suggests (`CaseAsk` takes `now`, `digest` or `feed`, and `CaseBook` reports each asked question through `onAsked`), and the new `QuestionDelivery` decides from the person's own limits (a daily number of pushes, quiet hours, a daily digest) which questions reach their channels, so the agent can never raise its own limit.
