---
'@robota-sdk/agent-mcp': patch
---

Keep a session readable whatever an MCP server declares. Narrowing now carries only the values the universal parameter schema admits, so `default: []`, `enum: ['x', null]`, `required: true`, a non-numeric `minimum` and similar no longer make the session record refuse to load, and a `null` property or union branch no longer throws. A dropped constraint is reported; a dropped annotation is not. A tool holding `type` beside `anyOf` is no longer quarantined, a `pattern` JavaScript cannot compile no longer throws at validation, and a root that named no properties no longer refuses every argument.
