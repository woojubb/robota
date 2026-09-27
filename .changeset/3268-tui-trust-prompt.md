---
'@robota-sdk/agent-cli': patch
---

An interactive start in an untrusted repository asks whether to trust the folder. Before, the TUI
started Restricted without saying so, and the project's settings, hooks, skills and MCP servers were
silently missing. The question comes before anything from the project is loaded and lists what trust
would load. A yes records the grant and starts normally. A no starts Restricted and asks again next
time. It is not asked:

- with `--safe-mode`;
- after a Restricted `/cd`;
- without a terminal;
- in a directory outside Git.
