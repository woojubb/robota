---
'@robota-sdk/agent-roundtable-acp': minor
---

`@robota-sdk/agent-roundtable-acp` is published for the first time. It seats an Agent Client Protocol agent as an `agent-roundtable` participant: the agent receives only the new public messages of each turn, and the text it says in reply becomes the turn's message. `spawnAcpAgent` launches the agent as a child process with exactly the environment it is given and ends its whole process tree when the session closes.
