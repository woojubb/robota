---
title: Build with Robota
description: Projects and tools built using Robota SDK — from CLI assistants to embedded AI agents.
---

# Build with Robota

Real projects built with Robota SDK. From terminal coding assistants to embedded AI in custom applications.

**→ [Submit your project](#submit-your-project)**

---

## Featured Projects

### Robota CLI

The reference implementation. A full AI coding assistant built entirely on top of `@robota-sdk/agent-framework` and `@robota-sdk/agent-transport/tui`.

- **Source:** [github.com/woojubb/robota](https://github.com/woojubb/robota)
- **Packages used:** `agent-cli`, `agent-framework`, `agent-transport`, `agent-command`, `agent-tools`
- **What it demonstrates:** Multi-provider switching, session persistence, permission system, plugin lifecycle, streaming TUI

---

### Visual Agent Builder Playground

A drag-and-drop canvas for assembling agents and exporting working TypeScript code. Runs entirely in the browser with BYOK (bring your own key).

- **Live:** [play.robota.io/playground](https://play.robota.io/playground)
- **Packages used:** `agent-framework`, `agent-provider`, `agent-tools`
- **What it demonstrates:** Browser-based SDK usage, SSE streaming, multi-provider BYOK

---

## Community Projects

_No community projects listed yet. Be the first to [submit yours](#submit-your-project)._

---

## Submit Your Project

To add your project to this page:

1. Your project must use at least one `@robota-sdk/*` package
2. Open a PR adding an entry to the **Community Projects** section above

**Entry format:**

```markdown
### Your Project Name

One sentence description.

- **Source / Live:** link
- **Packages used:** list of @robota-sdk/\* packages
- **What it demonstrates:** key integration patterns
```

**Requirements:**

- Public source code or live demo
- Uses at least one `@robota-sdk/*` package
- Working as of the PR date

---

## Related

- [Building Agents — guide](/guide/building-agents)
- [SDK framework](/guide/sdk)
- [Plugin Directory](/plugins/)
- [Examples](/examples/)
