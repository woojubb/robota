---
'@robota-sdk/agent-tools': patch
---

The built-in Read tool now decides containment on the file it actually opened, not on the path it
checked beforehand — closing a race where a path swapped for a symlink between the check and the open
could be followed outside the working directory. On macOS the canonical path is opened with
`O_NOFOLLOW_ANY`, refusing an open if any component is a symlink; on Linux the kernel's path for the
opened descriptor is read back and compared, and the open is refused when that cannot be confirmed (no
`/proc`) rather than allowed unconfirmed. The new `openWithinCwd` and `ContainmentEscapeError` exports
carry this check for other host-file tools to reuse.
