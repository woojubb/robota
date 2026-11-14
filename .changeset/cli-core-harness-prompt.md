---
'@robota-sdk/agent-cli': patch
---

Every run of the CLI now sends a short core harness prompt. It tells the model how the harness renders output and marks `<system-reminder>` blocks, to issue independent tool calls together, to report only what it verified (numbers in a final answer must come from tool results, otherwise "not run"), and to state a denied tool instead of routing around it. A preset's own system prompt follows the core, and `--system-prompt` still replaces the whole prompt. Interactive, print and serve runs all carry it, and `/context prompt` lists it as the `preset-system-prompt` section.
