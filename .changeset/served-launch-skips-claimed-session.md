---
'@robota-sdk/agent-cli': patch
---

`daemon start` and `session start --background` no longer fail while another runtime of the same workspace is running. A runtime's launch reused the workspace's empty saved session even when another live runtime held it, and was refused with `Session session_<id> is open in another process (…); close it there first. If that process is no longer running, release the session with: … --force`: a session the person never opened, with advice that is wrong for a live runtime. The launch now skips an empty session another process holds and starts a fresh one, so a daemon and any number of background sessions run side by side, each on a saved session of its own. An empty session left by a runtime that exited is reused as before, and `-r <id>` and `-c` of a session another process holds are refused as before.
