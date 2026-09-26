---
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-ui-web': patch
---

A key typed just as a permission or ask prompt appears no longer answers it.

- **`agent-ui-terminal`:** the permission prompt ignores its keys for a short pause after it appears (`PERMISSION_PROMPT_ARM_DELAY_MS`). While it waits it shows "keys answer in a moment" and no selection cursor. In screen-reader mode, a number typed during the pause is not kept for a later Enter.
- **`agent-ui-web`:** the docked prompt waits a short pause (`PROMPT_ARM_DELAY_MS`) before it takes focus, so keys typed during that pause stay in the composer. While it waits it says so. A click on a button answers at once, and Esc still denies or cancels.
