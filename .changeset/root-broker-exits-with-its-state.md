---
"@robota-sdk/agent-cli": patch
"@robota-sdk/agent-app": patch
---

The workspace root broker now exits once the user-state directory it serves is removed or replaced. Before, it ran until the next reboot, so every run with a temporary state directory, such as a test or a disposable smoke, left one more broker process behind. CLI and desktop restarts still reattach to held approvals while that directory remains.
