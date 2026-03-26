---
'@robota-sdk/agent-sessions': minor
'@robota-sdk/agent-sdk': minor
'@robota-sdk/agent-cli': minor
---

feat: session continue/resume — persist, restore, and switch sessions

- ISessionRecord.history field (required) for UI timeline restoration
- Session.injectMessage() for AI context restoration on resume
- InteractiveSession: sessionStore, resumeSessionId, forkSession, getName/setName
- CLI: --continue, --resume, --fork-session, --name flags
- TUI: /resume (session picker), /rename (session naming)
- ListPicker generic component with viewport scrolling
- Session name display: input border title, terminal title, StatusBar
- Session picker: cwd filtering, date+time, response preview
- React key remount for instant session switching
