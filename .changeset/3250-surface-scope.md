---
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-transport-webrtc-web': patch
'@robota-sdk/agent-cli': patch
---

The GUI surface's design now applies inside a `robota-ui` scope that each of its root components opens,
so an app with design tokens of its own can embed the surface without either overriding the other. Such
an app imports `@robota-sdk/agent-ui-web/styles/surface.css` into its Tailwind entry; a page that is only
the surface keeps importing `styles/theme.css` and puts `robota-ui` on its `<html>`. `RobotaMark` and
`RobotaWordmark` are exported. The browser remote client (`RemoteClient`) follows the same design, with
its pairing states centred on the page.
