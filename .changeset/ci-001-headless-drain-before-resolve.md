---
'@robota-sdk/agent-transport': patch
---

Fix a headless-run race (CI-001): the headless runner now resolves its exit code only AFTER the underlying `session.submit()` operation has fully settled, not off the terminal `complete`/`interrupted`/`error` event alone. Those events fire from inside the turn, BEFORE the turn's awaited `finally` runs session persistence / checkpoint finalize, so `run()`/`start()` previously returned while the session was still writing `.robota/` under cwd — a race a caller (or a test's cleanup) could lose (`ENOTEMPTY`). Each run now also emits exactly one terminal record. No change to exit codes or output shape.
