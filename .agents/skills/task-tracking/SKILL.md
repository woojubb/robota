---
name: task-tracking
description: Maintain an optional fixed-path repository work record when an issue or request is not sufficient.
---

# Optional task record

A Task is optional and must add durable information that the canonical issue/request and PR do not already own.

When needed, keep one Task at a fixed path under `.agents/tasks/`. Update its content in place; do not mirror a spec status, copy a parent status manually, or move the file through lifecycle directories. Link the canonical issue and PR. Record only decisions, remaining work, and authoritative verification evidence.

Do not create Task updates, commits, or file moves solely to prove process progression. Historical Task files retain their existing paths and meaning; no mass migration is required.
