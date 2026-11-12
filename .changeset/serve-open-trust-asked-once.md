---
'@robota-sdk/agent-cli': patch
---

`--serve --open` in an untrusted folder at a terminal now asks the trust question once. A person who answered "start Restricted" (or whose trust grant could not be recorded) was asked the same question a second time, because the startup check ran twice in a row.
