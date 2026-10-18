---
'@robota-sdk/agent-transport-acp': patch
---

Name a built-in file tool's path in the permission request an editor is asked about. The title of a Read request now reads `Read: <path>` instead of the tool name alone, because the adapter takes the call's identifying argument from the shared `permissionSummaryArgument` that the MCP transport also uses, which includes `filePath`.
