---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

Workspace trust no longer drops on its own. A grant was keyed by the repository config file and the
volume's device number, so `git push -u`, a branch rename or delete, `git remote add`, or macOS
renumbering a volume left a trusted workspace untrusted. Where the filesystem records a birth time
(APFS, ext4, NTFS, …), the key is now the git directory's own inode and birth time, which hold through
all of these while a repository recreated at the same path still does not inherit the grant; elsewhere
the stricter config-based key stays. Granting or revoking also clears a record left for the same
worktree under an earlier key, so it no longer counts as a second trusted repository.

Grants made before this change are keyed the old way: run `robota trust --yes` once more in each
workspace. A workspace revoked before shows as untrusted until it is trusted or revoked again.
