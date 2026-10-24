---
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
---

Preserve pending execution discovery and input admission in atomic Session conversation snapshots.
Strict synchronous checkpoints now gate waiting, settlement and abandonment acknowledgment; failed saves
require checkpoint repair without repeating execution. Restore before framework queue and autonomous
input admission, and refuse unresolved conversation copies. Read v1/v2 session envelopes and write v2;
older readers preserve v2 as unsupported, so coordinate reader versions when rolling back.
