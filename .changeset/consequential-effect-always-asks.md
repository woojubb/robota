---
'@robota-sdk/agent-core': minor
---

A tool can declare a consequential effect (`consequential: true` in its permission profile): one that leaves the machine and cannot be taken back, such as sending a message, spending money or placing a call. Such a call asks a person every time, in every mode including `bypassPermissions`. No allow rule, remembered consent, auto-mode classifier or hook answers it, and `plan` mode refuses it whatever its risk class. Tools that declare nothing are decided exactly as before.
