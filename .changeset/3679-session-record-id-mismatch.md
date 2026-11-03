---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
---

A session file whose record carries an id other than the one in its file name now loads as
`corrupt` (issue `the record belongs to another session id`) instead of as that other session, and
a project replay log whose entries name another session no longer rebuilds one. A record copied or
renamed to another id's file was being resumed, listed and saved under the wrong id. A load that
cannot read the file for a reason other than "no such file" also reports `corrupt`, never `missing`.

What to do: if you renamed session files by hand, rename them back to `<record id>.json`.
