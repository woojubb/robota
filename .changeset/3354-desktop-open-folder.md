---
'@robota-sdk/agent-app': minor
---

The desktop app works on the folder you open, not the folder its process was started in.

- **First launch:** the app asks which folder to open. After that it reopens the most recent folder that still exists. An installed app no longer falls back to `/` when started from Finder, the Dock, the Start menu or a launcher.
- **Switching folders:** **File → Open Folder…** (`Cmd/Ctrl+O`) switches folders, and **File → Open Recent** lists earlier ones. The trust question names the chosen folder. The window attaches to that folder's daemon and leaves the previous folder's daemon running.
- **Window and Dock:** the window title names the open folder. On macOS, clicking the Dock icon after closing the last window opens a new window on the same folder.
