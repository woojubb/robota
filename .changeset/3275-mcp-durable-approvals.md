---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-mcp': patch
---

MCP approvals now outlive the process, and an approval takes effect at once. The configured CLI keeps
activation decisions in `the configured user data directory` (owner-only) unless the host passes its own
`mcpApprovalStore`, so an approved server connects at later starts until its definition changes.
`/mcp approve <server>` now also connects the server in the running session, the way `/mcp reload`
does, instead of waiting for a restart. A remote server without OAuth therefore connects once
approved; stdio servers still need a host-supplied authority.
