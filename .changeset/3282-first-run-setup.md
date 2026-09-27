---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-gui-web': patch
---

A first run finds a provider, instead of a dead end. `robota --serve` (and the daemon it starts) no
longer refuses when no provider is configured: it starts in setup mode, and the GUI's conversation area
shows a "Connect a model provider to start" panel with a "Set up provider" button in place of the
composer. Answering it configures and swaps in the first provider live, with no restart. A startup
failure now says why — `robota daemon start --json` and the desktop app's fatal screen report the
child's own reason instead of a generic "readiness channel closed", and the fatal screen gets a Try
again button. `trust status --json` and the desktop trust dialog list only sources whose state trust
would actually change, instead of naming one this platform could not determine; the dialog shows one
sentence and a collapsed Details section. `robota --serve --open` in an untrusted folder now asks at
the terminal (trust it, start Restricted, or quit) when someone is there to ask, instead of refusing
outright.
