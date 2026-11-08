---
"@robota-sdk/agent-transport": patch
---

An owner link client now delivers what the runtime sent behind its first custody notice even when the runtime closed the stream right behind it. A Windows socket reports that end before the caller has attached its listeners, so the client dropped those session messages and custody notices and reported the link closed without them. They are now read first, and the end is reported after them.
