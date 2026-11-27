---
'@robota-sdk/agent-os': patch
---

`killProcessTree` with `processGroup` now keeps ending the process group after the direct child has exited: members that outlived it or ignore the signal are signalled and, once the grace passes, killed, and the call resolves only when the group is empty or a brief bounded wait after that kill has passed.
