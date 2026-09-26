---
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-ui-web': patch
---

A key typed just as a prompt appears no longer answers it: in the terminal UI the permission prompt, and in the web UI both the permission and the ask dock.

- **`agent-ui-terminal`:** the permission prompt ignores its keys for a short pause after it appears (`PERMISSION_PROMPT_ARM_DELAY_MS`). While it waits it shows "keys answer in a moment" and no selection cursor. In screen-reader mode, a number typed during the pause, or typed for the previous request, is not kept for a later Enter.
- **`agent-ui-web`:** the docked permission or ask prompt waits a short pause (`PROMPT_ARM_DELAY_MS`) before it takes focus, so keys typed during that pause stay in the composer. While it waits it says so. A mouse click on a button answers at once, and Esc still denies or cancels; Enter or Space on a focused button waits like any other key, and a button focused to answer one prompt hands focus back to the dock when the next appears.
