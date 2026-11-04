---
'@robota-sdk/agent-mcp': patch
---

Keep a session readable whatever an MCP server declares. Narrowing now carries only the values the universal parameter schema admits, so `default: []`, `enum: ['x', null]`, `required: true`, a non-numeric `minimum` and similar no longer make the session record refuse to load, and a `null` property or union branch no longer throws. A dropped constraint is reported; a dropped annotation is not. A tool holding `type` beside `anyOf` is no longer quarantined, a `pattern` JavaScript cannot compile no longer throws at validation, a root that named no properties no longer refuses every argument, an empty `anyOf` or `enum` no longer refuses every value, a schema nested thousands of levels deep no longer stops startup, and a `__proto__` property is no longer lost unreported.
