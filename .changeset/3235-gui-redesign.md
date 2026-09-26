---
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-cli': patch
---

The GUI session surface (desktop app, `robota --serve --open`) is redesigned as a calm desktop app: readable
type in a bundled Pretendard, monospace only for code and paths, surfaces separated by tone instead of
outlines, and light and dark themes that follow the system. Agent replies read as prose, your messages sit
in bubbles, tool calls are single quiet lines, and the composer carries the model, mode and effort. The
permission prompt now shows what the tool was asked to run, and the title bar names the current session.
