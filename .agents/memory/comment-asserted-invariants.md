# A comment that asserts an invariant nothing enforces

**Owner ruling, 2026-08-02:** _"반성은 재발방지를 위한 보편적이고 중립적인 강제가 실질적으로
이뤄지고 검증되어야만 반성했다고 볼 수 있다."_ — reflection counts as reflection only once a
**universal and neutral mechanical prevention** has actually been implemented **and verified**.
Naming a mistake is not reflection; naming it repeatedly is the same failure at the meta level.

## The class, measured

DAG-001 / PR #1600: eight review rounds, ~20 findings. **Four** were comments asserting a property
the code did not have.

| The comment said                                         | The code did                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "the lease is held during execution"                     | `return promise` in `try/finally` released it at the return statement — measured `executions: 2` where `develop` had 1                                            |
| "the state machine is the single place transitions live" | a literal `'cancelled'` wrote past it — and after that was fixed, two literal `'failed'` writes in the SAME function survived one more round. **Five instances.** |
| "the worker reloads its payload from storage"            | it reads `message.payload`; every recovered task would have run with `{}`                                                                                         |
| "this checks whether the status changed since the query" | it read the batch snapshot, so the guard could never fail                                                                                                         |

The comment is not merely unproven. It **stops the next reader from checking**, because the property
looks settled. In every one of these the next reader was the same author.

## The mechanism (landed, not proposed)

`scripts/harness/scan-authority-bypass.mjs` — a governed value written as a literal past its declared
authority is a finding. Registered in `run-all-scans`. **Neutral by construction**: the engine knows
no domain; its pairs come from `.agents/harness.config.json` → `authorityBypass`
(`writer`, `argumentIndex`, `authority`, `scope`), so another repository points it at its own
authorities and changes no code.

**Verified, three ways** — because a mechanism nobody proved fires is the class it is meant to catch:

- Restoring all three literals the reviewer found ⇒ the scan fails with exit 1 and names each site.
- Gutting its detection ⇒ 5 of its own 11 cases fail.
- Removing it from `run-all-scans` ⇒ its reachability case fails.

It states its own limit rather than overclaiming: it is syntactic, so a value laundered through a
variable passes. A check that overstates its reach is the vacuity this repo already measures.

Catalogued as [common-mistakes #83](../rules/common-mistakes.md).

## How to apply

When a comment states an invariant, the same change adds what enforces it — a test that fails when
the invariant is violated, or a scan. If neither is possible, write that the property is unenforced
rather than asserting it.
