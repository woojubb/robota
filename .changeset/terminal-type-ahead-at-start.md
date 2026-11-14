---
'@robota-sdk/agent-ui-terminal': patch
---

A key typed while the terminal UI starts is no longer lost. Ink reads the keyboard from its first frame on but hands each key to whoever listens at that moment, and the composer starts listening only after a later commit, so a key that arrived in between was read and dropped (typing `/exit` as soon as the prompt appeared lost the `/` in about one start in ten). The stdin proxy now keeps keys, in order and one keystroke at a time, until the app's start has settled, and delivers them to the composer; Ctrl+C is never held back.
