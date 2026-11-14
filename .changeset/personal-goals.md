---
'@robota-sdk/agent-product': minor
---

`@robota-sdk/agent-product/personal` adds goals and the feed. `GoalBook` keeps goals that run once or on a schedule, with optional read-only runs. Each run keeps its report and an audit trail of actions. The feed carries reports and approvals, and after a restart, approvals that can no longer be answered expire. The book has file and memory stores behind one port, and `GoalCreate`, `GoalList` and `GoalUpdate` tools.
