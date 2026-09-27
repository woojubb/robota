---
'@robota-sdk/agent-cli': patch
---

Starting a new TUI session in an untrusted repository asks whether to trust the folder. Before, the
TUI started Restricted without saying so, and the project's settings, hooks, skills and MCP servers
were silently missing. The question comes before anything from the project is loaded and lists what
trust would load. A yes records the grant and starts normally. A no starts Restricted and asks again
next time. If the grant cannot be recorded, it says so and starts Restricted.

It is not asked:

- when resuming or continuing a session, which stays in the store it was saved in;
- for setup commands (`init`, `--configure`, `--configure-provider`, `--set-current`);
- with `--safe-mode`, or after a `/cd` into a Restricted folder;
- without a terminal;
- in a directory outside Git.
