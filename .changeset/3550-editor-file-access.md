---
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-tool-defaults': minor
'@robota-sdk/pack-coding': minor
'@robota-sdk/agent-transport-acp': minor
'@robota-sdk/agent-cli': patch
---

**An editor that offers its file system carries the file tools' reads and writes.**

`Read`, `Write` and `Edit` take an optional `editorFiles` port (`IEditorFileAccess`), asked at each
call. On the host, after the tool's containment check (the permission gate has already decided),
`Read` returns the editor's text, unsaved changes included, and `Write` hands the content to the
editor; `Edit` reads where `Read` reads and writes where `Write` writes. The editor's text keeps
`Read`'s byte budget, binary refusal, formatting and cancellation, and an editor failure becomes the
tool's error result. `Glob` and `Grep` still search the disk and end their result with a note saying
so while an editor is attached. A sandbox with its own filesystem still carries every file tool, and
commands never use the editor. `createDefaultTools` and `createCodingPack` pass `editorFiles` through
to those tools only.

The ACP agent transport records the editor's `clientCapabilities.fs` and, once `session/new` binds the
session, hands the host an access through the new `onEditorFileAccess` option that sends
`fs/read_text_file` and `fs/write_text_file` for that session, for what the editor offered; stopping
the transport withdraws it. `robota acp` connects the two, so Read, Write and Edit go through the
editor in an editor that offers `fs`; `terminal/*` is not used.
