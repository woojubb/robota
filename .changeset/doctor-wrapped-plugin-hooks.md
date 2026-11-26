---
'@robota-sdk/agent-product': patch
---

The `/doctor` Extensions check no longer fails with `TypeError: (t ?? []) is not iterable` when an installed plugin ships its `hooks/hooks.json` wrapped under a `hooks` key, the form plugin authors usually write, which took the plugin, skill, hook and MCP checks down with it. The probe now reads the file the way the session does (events at the top level or wrapped under `hooks`), skips a value that is not a list where one belongs, counts the wrapped command hooks, and reports a wrapped value of the wrong type as a `plugin.<id>.hooks` warning naming the file and the field. A file with events at the top level is reported by the existing schema check as before.
