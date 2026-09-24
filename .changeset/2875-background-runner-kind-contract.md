---
'@robota-sdk/agent-executor': major
---

Type each built-in background runner's `start` request to its declared kind. Direct callers with a widened or mismatched request must narrow it before starting a runner. Custom runner classes that implement the exported runner type must specify their kind parameter. Manager registration and dynamic dispatch remain supported.
