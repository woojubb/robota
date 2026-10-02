# Audit contract v1

This is the maintained contract for the manual developer audit. IDs retain the complete scope of the developer audit request; changes to obligations, applicability or thresholds require a new contract version and visible comparison. User-specified scope and requirements take precedence. This contract is not an enterprise certification.

## Obligations

Every obligation receives a record; split compound obligations into named scenarios so a partially verified item cannot pass. Full runs cover all IDs and the exhaustive first-party module ledger. Profiles are embedded SDK, local CLI/daemon, desktop, browser/remote host, hosted organizational execution and DAG HTTP/workflow service. Record private/example/research applicability rather than treating those as deployed guarantees.

| ID | Required inspection and evidence |
| --- | --- |
| A1 | Map actual packages, public APIs and composition roots to `VISION.md`, `ARCHITECTURE.md` and applicable SPEC contracts; identify contradictory promises, undocumented ownership and stale package identities. |
| A2 | Inspect production, peer and development manifest graphs plus source imports, dynamic imports, barrels, subpaths and bundles: cycles, undeclared edges, reverse layering, sibling coupling and duplicated contracts. `deps:check` alone does not establish the full manifest graph. |
| A3 | Verify neutral foundations, provider injection, ports/adapters, contract ownership, SDK/product/DAG separation and explicit composition of required capabilities. Examine global state, shared mutable state and hidden infrastructure dependencies. |
| A4 | Review cohesion, unnecessary indirection, duplicated execution loops and policy implementations, extension compatibility and the cost of likely changes. Exercise representative additions of a provider, tool/plugin and transport through documented seams; propose refactors only for a supported defect or relevant change constraint. |
| B1 | Trace run/stream execution, tool-call IDs, complete argument validation, typed results, mixed media, progress, terminal errors and partial completion through provider, core, session, persistence and UI. |
| B2 | Verify ordering, dependency-aware parallelism, bounded concurrency, fan-in, skipped/unknown outcomes, approval suspension, cancellation and retry rules; distinguish observation loss from an unexecuted effect. |
| B3 | Compare adapters for supported capabilities, timeout/rate-limit handling, stream interruption, fallback after partial output, token/cost accounting and model metadata freshness. Unsupported combinations must fail intelligibly. |
| B4 | Examine context limits, compaction, memory provenance/correction/deletion, prompt caching and trust framing across restart and provider changes; avoid losing permissions, result identity or recovery receipts. |
| C1 | Verify creation, concurrent submissions, abort, shutdown, fork, handoff, resume and daemon restart through public interfaces; check races, stale handles and process ownership. |
| C2 | Inspect child/subagent definitions, inherited permissions, budgets, context, allowed tools and workspace isolation. Agent messages must not create user authority or approval. |
| C3 | Exercise background commands, schedules, loops, wake queues and goals for duplicate/missed events, bounded continuation, stop behavior and cleanup after abnormal exits. |
| C4 | Verify transcript/event ordering, replay gaps, reconnect delivery semantics and isolation between workspaces, worktrees, users and sessions. |
| D1 | Inspect Shell/Bash, Read/Write/Edit, Git, web/media fetch, hooks, commands, skill expansion and MCP effects for canonical path containment, symlink/TOCTOU races, argument injection and inherited environment leakage. |
| D2 | Verify tool/skill/command descriptions and deliberate model-invocation policy. Installation, credential use and authority widening retain their required user-only boundary. |
| D3 | Audit bundle installation/update/disable/uninstall, source/version pinning, manifest normalization, namespacing and path validation; declarative inspection must not execute untrusted code. |
| D4 | Test MCP protocol/capability negotiation, stdio/HTTP and supported stateless/skills routes, OAuth/admission, reconnect, result/resource/media limits, digest/provenance checks and active-call disposition during lifecycle changes. |
| E1 | Draw trust/data-flow boundaries and threat actors for each deployment profile: malicious repository, prompt, tool result, plugin, peer agent, remote client and compromised worker. Run positive controls alongside adversarial cases. |
| E2 | Verify authentication/authorization, tenant/task/session/actor ownership, least privilege, delegation, replay/TTL/epoch handling, issuer outages and revocation through actual admitted calls. Assess SSO/OIDC/SAML, RBAC/ABAC and provisioning needs against the target profile; classify unsupported needs without assuming all enterprise standards are mandatory. |
| E3 | Audit exact-operation user approval, secret custody/redaction, management-plane separation, ingress/egress policy, DNS/IP/redirect/proxy bypasses and sandbox guarantees. Separate application policy from OS/provider containment. |
| E4 | Verify task/ancestor/tenant/global resource and cost reservations, concurrent admission, trusted usage, policy rollback boundaries and emergency stop of all descendants/connections. Reuse verified organizational and cloud-validation requirements and physical/cloud measurements. |
| F1 | Inventory authoritative stores versus caches, transcripts and snapshots; inspect atomic writes, locking, corruption handling, schema/version migration, retention and rollback detection. |
| F2 | Reproduce duplicate dispatch, CAS/lease/fence conflicts, crash before/after effects, lost acknowledgement and unknown outcomes using real disposable file/DB/Git effects and representative external fixture services. |
| F3 | Verify receipts, idempotency and owner reconciliation; never infer external exactly-once behavior from an internal database commit or a successful retry. |
| F4 | Exercise backup/restore and checkpoint/revoke/restore with current authority and accounting; measure recovery objectives, data loss and resource cleanup for the target topology. |
| G1 | Inspect HTTP/WebSocket/MCP/WebRTC boundaries: schema validation, admission, frame/body limits, backpressure, ordering, heartbeat, disconnect, reconnect and cross-client session ownership. |
| G2 | Verify TLS, Origin/Host/CORS/CSP, trusted proxies, pairing/signaling, scoped token handling and browser storage; assess publicly exposed versus loopback-only assumptions. |
| G3 | Review Electron main/preload/renderer isolation, sandbox and IPC, navigation, file/protocol handlers, daemon connection and bundled-runtime/update behavior in supported native environments. |
| G4 | Exercise CLI interactive/print/serve/MCP routes, desktop and web clients, GitHub Action and starter/server entry points for correct errors, approval flows, interruption, usable recovery and accessibility. Record unsupported platform lanes explicitly. |
| H1 | Verify node/runtime/worker/builder/API/projection boundaries, provider-neutral injected definitions and compatibility between the CLI catalog and optional/private workspace catalog. |
| H2 | Inspect graph validation, scheduling, branches, fan-in, cycle rejection, retries, cancellation and partially completed nodes for bounded, deterministic outcomes. |
| H3 | Check workflow definitions, instant/skill/media nodes and file/HTTP effects for the same authority and resource boundaries as ordinary tools. |
| H4 | Exercise persisted workflow migrations, SQLite/local adapters, concurrent workers and crash/restart; separate in-process workflow behavior from distributed durability claims. |
| I1 | Establish reproducible workloads for concurrent tenants/sessions/agents, long transcripts, large catalogs/media, DAG graphs and slow consumers; run a small baseline before selecting stress sizes. |
| I2 | Measure throughput, p50/p95/p99 latency, event-loop delay, startup/resume time, memory/CPU/file descriptors, disk growth and cost per successful task. Separate model, runtime, transport and tool time. |
| I3 | Test saturation, queue limits, fairness/noisy neighbors, rate limiting and backpressure. Inspect unbounded buffers/caches, synchronous blocking and repeated scanning/serialization. |
| I4 | Run bounded soak/fault tests for provider/storage/network outages, process crash and partial initialization; measure leakage and recovery. Inspect replication/failover needs without calling a single-process fixture highly available. |
| J1 | Verify structured logs, trace/metric correlation across descendants, health/readiness signals, diagnostic redaction, useful alerts and incident investigation with synthetic workloads. |
| J2 | Inspect audit integrity/retention/access, independent custody, export and incident-stop/recovery runbooks; assign an operating owner to each external obligation. |
| J3 | Map stored/transmitted user and model data, consent, retention/deletion/export, encryption, residency and provider handling against the chosen requirements. Include telemetry and support bundles. |
| J4 | Evaluate configuration/secret rotation, centralized policy, deployment/upgrade/rollback, tenancy/admin interfaces, support/version policy, onboarding and license/dependency compatibility. Identify gaps for qualified review where contractual/legal conclusions are required; engineering evidence is not compliance certification. |
| K1 | Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm deps:check` at the frozen execution revision. Record scope/skips/caches/environment; account for apps and examples outside root build coverage. |
| K2 | Inspect meaningful negative/boundary/integration coverage, flaky tests, mocked guarantees and failure observability. Use targeted mutation or red-before probes where they resolve uncertainty; raw test/coverage counts are not acceptance. |
| K3 | Review CI scope selection, required merge checks, build-artifact provenance/reuse, dependency lock/patches, vulnerability handling, secret scanning and release permissions. Reuse existing checks in the manual workflow; admit new persistent checks only under the reusable-gate policy below. |
| K4 | Validate actual package tarballs/binary/app artifacts in clean consumers: exports/types/ESM/CJS where supported, browser/Node boundaries, install/runtime assets, dependency/licenses, supported macOS/Linux lanes, release integrity and upgrade/rollback. Verify public documentation/examples against those artifacts. |
| L1 | Run disposable bug-fix, API extension, cross-package change, regression diagnosis and interrupted-task recovery scenarios through actual public product routes; independent verifiers inspect resulting files/tests/effects. |
| L2 | Include a repository outside this monorepo and an external non-GUI tool/plugin fixture to test reuse beyond this monorepo. Use verified reuse outcomes and interoperability evidence where applicable. |
| L3 | Compare single-agent and bounded specialist delegation on matched tasks and declared model settings; record success, rework, policy failures, elapsed time and cost including failed attempts. |
| L4 | For live stochastic comparisons, predeclare trial count and resource limits, report sample size/variation and all failures. Replay tests prove mechanics, not model competence; agent self-reports cannot score their own completion. |

## Evidence and gates

Per obligation/scenario use `verified`, `failed`, `partially_verified`, `not_implemented`, `blocked_unexecuted` or `not_applicable`. Only `verified` with required evidence, or justified `not_applicable`, satisfies a mandatory obligation. The required evidence is profile-specific: source establishes design/ownership, actual product integration establishes journeys, deployed measurements establish physical isolation/scale/recovery. Record expected/observed results and initial failures, not just a final successful attempt.

Gate precedence: FAIL when a mandatory applicable requirement demonstrably fails or is not implemented; otherwise INCOMPLETE when a mandatory evidence/target/independent-review obligation is unmet; otherwise PASS. Preserve incomplete obligations alongside failures. Never let a score, narrowed scope, missing worker/provider, stale evidence, omitted finding or conditional pilot satisfy a stronger contract. Gate adjudication is accountable review, not a custom executable or a promise of machine-enforced semantic correctness.

Give each profile `ready_for_target`, `conditional_pilot`, `not_ready` or `undetermined`. Readiness needs specified targets, verified required controls/journeys and measurements, operating ownership and no unresolved critical/high blockers. A provisional workload can provide evidence but cannot satisfy an unspecified SLA. Record scale/concurrency, supported OS/runtime/providers, data classes, latency/availability/recovery objectives and support owner, or the exact missing decision.

Findings distinguish confirmed defects, suspected risks and future gaps. Include severity/priority/confidence, affected profiles, revision, path/line, requirement, reproduction/evidence, impact, fix direction and existing issue. Reuse verified Robota issues whose scope owns remediation. Sanitized public references follow SECURITY.md. Assessment completion, quality-gate pass and product readiness are separate facts.

## Result and evidence records

Write a human `report.md` and machine `result.json` in a run directory. Use this record shape; unresolved values stay explicit rather than invented:

```json
{
  "runId": "unique run identifier", "revision": "immutable source SHA", "sourceState": {"dirty": [], "snapshotDigest": "content digest"},
  "contract": {"version": 1, "digest": "sha256"}, "skillDigest": "sha256", "scope": "full",
  "profiles": [{"id": "embedded_sdk", "requirements": {}, "missingInputs": [], "verdict": "undetermined", "gate": "INCOMPLETE"}],
  "environment": {}, "resourceBounds": {}, "agents": [{"owner": "name", "model": "actual identifier", "settings": {}, "calibration": "evidence reference"}],
  "units": [{"path": "tracked path", "sha256": "content hash", "owner": "reviewer", "kind": "production_source", "review": "unreviewed", "note": "specific inspected behavior or reason pending", "obligations": ["A1"], "evidence": []}],
  "checks": [{"command": "pnpm build", "exitCode": null, "scope": "actual covered units", "disposition": "blocked_unexecuted", "evidence": []}],
  "obligations": [{"id": "A1", "scenarios": [{"name": "contract ownership", "profiles": ["embedded_sdk"], "mandatory": true, "disposition": "blocked_unexecuted", "evidence": [], "limitations": []}]}],
  "evidence": [{"id": "unique evidence ID", "kind": "source", "revision": "SHA", "configuration": {}, "environment": {}, "expected": "observable condition", "observed": "actual result", "artifact": "relative evidence path", "sha256": "artifact hash", "owner": "name", "independentReview": null}],
  "findings": [], "gate": "INCOMPLETE", "assessmentComplete": false, "limitations": [],
  "comparison": {"priorRun": null, "compatible": false, "changes": [], "reused": [], "invalidated": []}, "usage": {"elapsedSeconds": null, "tokens": null, "costActual": null, "costEstimate": null}
}
```

`review` becomes `reviewed` only after actual whole-file source inspection; tests/scripts/configs are first-party executable modules too. Documentation/configuration inventory has its own treatment, and generated/vendor exclusions include provenance. A hash proves identity, not inspection. Do not fill every unit with an identical clean note or conflate successful tooling with a human/model review.

High-impact findings and high-risk pass claims reference an independent verifier and its actual evidence. Lower-model calibration, uncertain-result escalation and sampled clean reviews are visible. Models do not award themselves completion. A full assessment is complete only when the executable-module review is exhaustive, all obligations have supported dispositions/blockers, required deliverables exist and independent final review resolves report defects; readiness may still be false or undetermined.

On resume/comparison, use immutable revision, dirty-snapshot digest, contract/skill versions, environment/configuration, evidence hashes and affected dependency scope. Unmatched inputs invalidate affected evidence and review. Threshold changes and scope reductions are reported separately from improvements; prior omissions/changed findings remain visible. Report actual/estimated/unavailable usage separately and never equate token count with invoice cost.
