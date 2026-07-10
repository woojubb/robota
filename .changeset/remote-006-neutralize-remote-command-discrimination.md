---
'@robota-sdk/agent-framework': minor
---

REMOTE-006 Stage B4-1: neutralize the remote-command discrimination — local == remote (owner principle). Pairing
(Stage B3) is the sole trust boundary; a paired peer is the session owner, identical to the local operator, and
capability is governed uniformly by the universal permission system (permission modes + PermissionEnforcer + the
ask/approval handler), not by an origin penalty. `createDefaultRemoteCommandPolicy()` now **allows by default**
(a transport-origin command runs exactly as a locally-typed one), and the skill-router gate no longer denies when
no policy is injected. The `IRemoteCommandPolicy` seam remains as an OPTIONAL, user-configured restriction. This
supersedes the REMOTE-003 (B1) `'remote'` deny-by-default gate, which was origin discrimination and incoherent (it
gated only the narrow `command` verb while the model's tools/skills — the dominant side-effecting routes — were
never gated). No user-facing enable path; the genuinely-remote WebRTC path stays pairing-gated and unwired, with a
hard precondition that it must not ship before the transport-neutral permission/ask flow (REMOTE-007).
