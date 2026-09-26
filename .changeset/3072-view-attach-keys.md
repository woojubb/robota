---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-ui-terminal': minor
---

`robota session view` attaches to and peeks at sessions.

- `a` attaches to the selected session to drive it, and `p` peeks at it read-only. Both are offered, in
  the footer and in help, only on a row that is alive, controllable and verified. The view asks first,
  naming the role. The yes is held to the process start the row showed: if the session restarted or
  lost control meanwhile, the attach is refused. Detaching returns to the view, on the same row and
  grouping, without printing the screen-reader line again.
- **Breaking:** opening a row's linked PR moves from `p` to `o`.
- The attached view shows the keys for what is on screen: sending, answering a permission, or
  answering a question. With a screen reader it words every line ("Prompt from attach:2: …",
  "Tool started: …", "Permission needed: …") and uses no symbols.
- Questions wait their turn: a second permission request or question no longer replaces the one on
  screen, and one settled elsewhere leaves the queue.
- Line breaks inside pasted text become spaces instead of sending the text. In a masked answer they are
  dropped, so a copied key that ends with a line break is kept exactly.
- `robota session attach` accepts `--screen-reader` and `--no-screen-reader`.
- The attach client closes a connection that sends more frames than it can hold before the view reads
  them.
