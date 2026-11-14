---
'@robota-sdk/agent-framework': patch
---

A session record kept every background task event for the life of the session and was rewritten in full on every output chunk a job streamed, so a long-running streaming job made the record grow without bound and each save cost more than the last. The record now carries a bounded recent window of task events, with lifecycle events and output or tool-activity events windowed separately so a stream of output cannot push a job's lifecycle out of it. Output is saved at most once a second; a task's lifecycle changes, its end and the session's shutdown still save at once, and a crash loses at most the last second of output events.
