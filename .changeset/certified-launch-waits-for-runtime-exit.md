---
"@robota-sdk/agent-cli": patch
---

A launch of a secure runtime that fails after the runtime was proved (certification refused, the daemon role not accepted, a deadline missed) now returns only once that runtime is gone. The runtime ends itself when its spawner leaves without certifying it, which closes its control before it answers the launch's stop request; the launch took that for "already gone" and returned while the runtime was still registered, so a caller that went on at once saw a live session with no control.
