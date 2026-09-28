# @robota-sdk/agent-cli-web

## 3.0.0-beta.85

### Patch Changes

- @robota-sdk/agent-ui-web@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- e8d70ac: A first run finds a provider, instead of a dead end. `robota --serve` (and the daemon it starts) no
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
- Updated dependencies [29486da]
- Updated dependencies [e8d70ac]
  - @robota-sdk/agent-ui-web@3.0.0-beta.84

## 3.0.0-beta.83

### Patch Changes

- Updated dependencies [7b72344]
- Updated dependencies [9ecffed]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [57f57f5]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [227ff3a]
- Updated dependencies [f8a8a4d]
  - @robota-sdk/agent-ui-web@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- @robota-sdk/agent-ui-web@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- @robota-sdk/agent-ui-web@3.0.0-beta.81

## 3.0.0-beta.80

### Patch Changes

- Updated dependencies [1e3f91a]
  - @robota-sdk/agent-ui-web@3.0.0-beta.80
