---
'@robota-sdk/agent-mcp': minor
---

Keep a session readable whatever an MCP server declares. Narrowing now carries only the values the universal parameter schema admits, so `default: []`, `enum: ['x', null]`, `required: true`, a non-numeric `minimum` and similar no longer make the session record refuse to load, and a `null` property or union branch no longer throws. A dropped constraint is reported; a dropped annotation is not. A tool holding `type` beside `anyOf` is no longer quarantined, a `pattern` JavaScript cannot compile no longer throws at validation, a root that named no properties no longer refuses every argument, an empty `anyOf` or `enum` no longer refuses every value, a schema nested thousands of levels deep no longer stops startup, a `__proto__` property is no longer lost unreported, a `required` name with no property no longer stops the agent initializing, and a tool with no description no longer fails to register, a truncated tool name stays inside the alphabet vendors accept, and a duplicate `required` name no longer reaches the wire.

Breaking: `ThirdPartySchemaValidator` and the `report` option of `createDiscoveredTool` are removed. A discovered tool validates against the schema narrowed at catalog registration, which reports through `buildCatalog`'s `report` option.
