# TUI Keybindings

Robota's interactive terminal UI reads contextual keyboard overrides from
`~/.robota/keybindings.json`. Run `/keybindings` in an interactive session to create the sparse
file when it does not exist and open that exact file in your configured editor. Saving the file
reloads valid changes without restarting Robota. Invalid replacements are rejected atomically: the
TUI shows the file, JSON path, and error while the last valid bindings remain active.

The generated document links to the published
[JSON Schema](https://docs.robota.io/schemas/keybindings.schema.json), so compatible editors can
validate context and action names.

## File format

```json
{
  "$schema": "https://docs.robota.io/schemas/keybindings.schema.json",
  "version": 1,
  "bindings": {
    "chat-input": {
      "submit": "ctrl+j",
      "history-previous": null
    },
    "workspace-switcher": {
      "attach": ["a", "g g"]
    }
  }
}
```

The document is sparse: omitted actions retain their defaults. A value can be one binding, a
non-empty list of alternatives, or `null`. `null` removes every binding for only that action.
Unknown contexts or actions, malformed bindings, duplicates, and single-key/chord-prefix conflicts
reject the complete replacement.

Bindings contain one or two space-separated strokes. Modifiers are written before the key, such as
`ctrl+k` or `ctrl+x ctrl+s`. `control` aliases `ctrl`; `option` aliases `alt`; and `cmd` or `command`
alias `meta`. A bare uppercase letter means Shift, so `A` becomes `shift+a`.

## Contexts, actions, and defaults

| Context              | Default actions                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`                | `open-workspace-switcher`: `ctrl+b`                                                                                                                                                                                                         |
| `thinking`           | `abort`: `escape`                                                                                                                                                                                                                           |
| `background-detail`  | `return-to-main`: `escape`                                                                                                                                                                                                                  |
| `recovery`           | `retry`: `enter`                                                                                                                                                                                                                            |
| `chat-input`         | `submit`: `enter`; `history-previous`: `up`; `history-next`: `down`; `history-search`: `ctrl+r`; `cursor-left`: `left`; `cursor-right`: `right`; `delete-backward`: `backspace`, `delete`; `delete-word`: `ctrl+w`; `delete-line`: `ctrl+u` |
| `text-input`         | `submit`: `enter`; `cursor-left`: `left`; `cursor-right`: `right`; `cursor-up`: `up`; `cursor-down`: `down`; `delete-backward`: `backspace`, `delete`; `delete-word`: `ctrl+w`; `delete-line`: `ctrl+u`                                     |
| `autocomplete-menu`  | `previous`: `up`; `next`: `down`; `close`: `escape`; `accept`: `tab`; `execute`: `enter`                                                                                                                                                    |
| `queued-prompt`      | `cancel`: `backspace`, `delete`                                                                                                                                                                                                             |
| `confirm-prompt`     | `previous`: `left`, `up`; `next`: `right`, `down`; `confirm`: `enter`; `choose-yes`: `y`; `choose-no`: `n`                                                                                                                                  |
| `permission-prompt`  | `previous`: `left`, `up`; `next`: `right`, `down`; `confirm`: `enter`; `allow-once`: `y`; `allow-session`: `s`, `a`; `allow-project`: `p`; `deny`: `n`, `d`                                                                                 |
| `text-prompt`        | `submit`: `enter`; `cancel`: `escape`; `delete-backward`: `backspace`, `delete`                                                                                                                                                             |
| `list-picker`        | `previous`: `up`; `next`: `down`; `select`: `enter`; `cancel`: `escape`                                                                                                                                                                     |
| `menu-select`        | `previous`: `up`; `next`: `down`; `select`: `enter`; `back`: `escape`                                                                                                                                                                       |
| `multi-select`       | `previous`: `up`; `next`: `down`; `toggle`: `space`; `confirm`: `enter`; `cancel`: `escape`                                                                                                                                                 |
| `workspace-switcher` | `previous`: `up`; `next`: `down`; `select`: `enter`; `close`: `ctrl+b`, `escape`; `attach`: `a`                                                                                                                                             |
| `background-list`    | `previous`: `up`; `next`: `down`; `open`: `enter`; `close`: `escape`                                                                                                                                                                        |
| `transport-settings` | `previous`: `up`; `next`: `down`; `toggle`: `space`; `close`: `enter`, `escape`                                                                                                                                                             |
| `history-search`     | `previous`: `up`; `next`: `down`, `ctrl+r`; `cycle-scope`: `ctrl+s`; `insert`: `enter`, `tab`; `execute`: `ctrl+e`; `cancel`: `escape`                                                                                                      |

Bindings can be reused by different contexts. Within one context, every received physical input can
belong to only one action.

## Terminal limits and reserved input

- `Ctrl+C` is reserved for Robota's two-stage shutdown and cannot be rebound.
- `Ctrl+B` is valid, but Robota warns because terminal multiplexers commonly capture it.
- Some terminals cannot distinguish `Ctrl+Shift+letter` from `Ctrl+letter`; Robota accepts the
  binding with a delivery warning.
- Terminal control codes make `Ctrl+M` equivalent to Enter, `Ctrl+I` equivalent to Tab, and `Ctrl+[`
  equivalent to Escape. Robota resolves those aliases and rejects same-context collisions between
  them. `Ctrl+J` is the distinct LF byte; Robota normalizes that exact byte as `Ctrl+J` before text
  and paste handling.
- Unmodified printable characters cannot begin chords in text-entry contexts. Typed text, paste,
  Korean IME composition, and screen-reader numbered selection stay on their dedicated input paths.
- Robota does not include a modal editor. Modal behavior provided by your terminal or external editor
  is outside this registry.

Footer hints are generated from the current effective bindings. They update after a valid reload and
disappear when an action is unbound.
