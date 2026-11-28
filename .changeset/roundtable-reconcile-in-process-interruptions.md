---
'@robota-sdk/agent-roundtable': minor
'@robota-sdk/agent-roundtable-robota': minor
---

A durable conversation reconciles a stop inside a living process (a run time limit, a caller's signal, `dispose()`, a spent allowance) the way it reconciles a process death. A member that had entered its runtime stays `running` under its own attempt id, its session is discarded, and the next `run()` reconciles it from the participant's journal, so an effect that completed before the stop is not run again; a member that never entered its runtime is dispatched again as before. An interrupted selection in a durable conversation answers its reserved calls as unknown (kept counted until the host reconciles them) and is asked again. A conversation that is not durable behaves as before: a completed effect can run again after a cancel or a timeout.

`sessionParticipant` with a recovery journal seals each attempt's journal: its Session writes nothing from the moment the run is stopped, and once the turn settles or the session is released the attempt refuses appends and effect-call claims with the new `attempt-sealed` participant error, while reads stay open for reconciliation. A turn the Session finished before a stop was observed is journaled and returned instead of being discarded.
