---
'@robota-sdk/agent-framework': major
---

Honor skill model selection in forked child sessions. Skill metadata that specifies a model now requires `context: fork` instead of silently ignoring the model during ordinary execution. Startup errors for configured hooks without executors now identify their settings sources.
