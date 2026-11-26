---
'@robota-sdk/agent-cli': patch
---

`session stop`, `session rename`, `session link-pr`, `session unlink-pr` and `session events list|revoke` now say `No supervised session <id> exists.` when the id is well-formed but has no registration (it never ran here, or its runtime has already stopped). Before, they printed the raw `ENOENT: no such file or directory, lstat '…/supervised/<id>'` error, which named a path under the user's state directory. The refusals for an id that is not well-formed, for a registration that changed since it was listed, and for one whose process is not proven alive read exactly as before.
