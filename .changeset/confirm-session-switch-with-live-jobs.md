---
'@robota-sdk/agent-ui-terminal': patch
---

Switching sessions from the resume picker or `/resume` stopped the running session's channel, and with it every background job still running, without asking. A local switch that would stop live background jobs now asks first and says how many; declining leaves the person on their session with the jobs running. Continuing an ended fork asks once, not twice, and a terminal attached to a host still asks nothing because the host keeps the jobs.
