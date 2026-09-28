---
'@robota-sdk/agent-framework': patch
---

Bundle plugin skills and commands now run. They were listed in the command menu, but typing one
answered "Unknown command", and the model could neither see nor activate them: the session's skill
router and the prompt's skill list read only the host's skill roots. A session now also reads the
skills and commands of the bundle plugins it may load, behind the same gates as plugin hooks (not
in a bare session, project plugins only in a trusted workspace, disabled plugins skipped), on each
lookup, so a newly installed or enabled plugin works without a restart. A session's own skill of
the same name still wins.
