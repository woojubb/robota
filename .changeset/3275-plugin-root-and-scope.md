---
'@robota-sdk/agent-framework': patch
---

A bundle plugin skill can use `${CLAUDE_PLUGIN_ROOT}`: it expands to the plugin's folder in the
skill's body, and `` !`command` `` preprocessing gets it in the environment, as plugin hooks already
did. Every skill's commands now get `CLAUDE_PLUGIN_ROOT` set (empty outside a plugin), so a value the
host process carries never stands in for it. A session also loads project plugins, skills and hooks
alike, only from a folder inside the trusted workspace; trust granted to one repository does not
extend to a plugin folder elsewhere.
