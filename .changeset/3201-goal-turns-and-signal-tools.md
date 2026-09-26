---
'@robota-sdk/agent-framework': patch
---

`/goal` turns no longer show the goal loop's instruction to the model as a user message. Each surface
shows `Goal: <objective> (iteration n of max)`, and the session's auto-generated name comes from that
line. The goal's `report_goal_status` and the self-paced loop's `report_loop_decision` are
classified as inspections, so they neither ask for permission every turn in `default` mode nor get
refused in `plan` mode, where a goal could never finish.
