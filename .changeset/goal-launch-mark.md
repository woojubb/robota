---
'@robota-sdk/agent-product': minor
---

A goal can carry the id of the launch it was made for as a typed `launch` mark (`IGoal.launch`, `ICreateGoalInput.launch`). `GoalBook.create` with a launch id returns the goal that already carries it instead of making a second one, under the same lock every goal write takes, so a host that stopped between making the goal and recording it finds it again.
