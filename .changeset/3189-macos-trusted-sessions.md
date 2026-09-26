---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': patch
---

A trusted workspace saves its sessions on macOS and other hosts without Linux's project-write guarantee.

- **`agent-framework`:** `supportsWorkspaceProjectMutation(platform?)` tells a host in advance whether project writes can be proven to stay under the trusted root. The project writer uses the same answer, so the two cannot disagree.
- **`agent-cli`:**
  - Where project writes cannot be proven safe, a trusted workspace keeps its sessions in the user session store (`~/.robota/sessions`). They are listed for that workspace by their working directory, so `/resume`, the sessions sidebar, `--continue` and `robota session list` find them. Nothing is written under the project root.
  - Before this, every save in a trusted git workspace on macOS was refused, and those surfaces listed nothing.
  - Linux keeps trusted sessions in the project, as before.
  - `robota session list`, `robota usage` and `robota session analyze` report such sessions as user sessions, never as project sessions.
