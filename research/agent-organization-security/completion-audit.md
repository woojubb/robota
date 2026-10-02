# Completion evidence audit

Overall completion has not been established. Distinguish documentation proposals, local research
prototypes and actual cloud-provider behavior. Production security enforcement and provider selection
remain incomplete.

| Acceptance area | Current evidence | Remaining measurements and implementation |
| --- | --- | --- |
| Local/hosted data and permission flows compared with code | Sandbox source review; 16 Linux observations; 5 actual KVM CLI checks covering Read/Write/Git/subagents; 5 daemon-auth checks; 5 MCP-stdio checks; 14 actual CLI remote-MCP/HTTPS-issuer checks; 7 actual TUI/PTY checks; source boundaries for serve/background/shellExec | Public issuer/proxy and desktop connection; production CLI-to-separate-task-worker/broker integration |
| Least privilege, approval, isolation and attack containment | Ownership/threat table; host/sibling file separation in two KVMs; denial of 3 direct TCP destinations; synthetic-broker task/actor/TTL/approval rejection | Provider DNS/raw-IP/redirect/Unix-socket/management-API boundaries and integrated prompt/tool-result attacks |
| Parallel and long-running identity, delegation, state, audit and interruption | Shared contracts, sibling/ancestor budget races, CAS/fencing, leaf/root revocation and separate-worker topology | Long workloads; token/CPU/time/concurrency and task/tenant/global limits; bounded revocation latency |
| Permission violations, duplicate effects, approval and retry/recovery proofs | 24 integrated local organization-policy/recovery checks across two actual guests; idempotent/non-idempotent external services; actual crash/reconciliation; 10 cross-language signature checks and 4 actual Git conflict/CAS checks | Actual cloud-worker/CLI integration, production asset-owner reconciliation APIs and Git branch/lease recovery |
| Fly Machines/Sprites/E2B/Lambda official material and proof-of-concept comparison | Official material with role/lifetime/cost distinctions and a pinned local KVM/artifact recipe | Actual provider lifecycle/SDK, latency and usage/cost measurements after account/region/budget authorization |
| Missing/failed hosted sandbox, restore and secret boundaries | No host retry after backend failure; unknown-worker-factory errors; minimal confidentiality exposure cases; proposed hosted fail-closed policy | Mandatory worker/broker enforcement at production hosted admission; actual provider restore/outage and secret isolation |
| Incident ownership, detection, audit, revocation and recovery | Responsibility table; audit redaction/tamper/anchor checks; integrated local revoke → VM/tunnel/child stop → disk restore → old-identity rejection → new-key/current-ledger recovery; 4 independent VM-lifecycle checks | Integrated production/cloud recovery, tenant/global kill, revocation latency, remote audit anchors and operating-owner recovery APIs |
| Selected topology execution, interruption, resume, cleanup, cost and follow-up work | Local VM configuration/lifecycle results, provider comparison and a concrete cloud plan | Authorized provider measurements, resource cleanup/invoice reconciliation and final topology rationale; follow-up implementation areas are listed below |

Acceptance areas 3 (shared contracts/reference architecture), 6 (hosted-failure policy/secret
boundaries) and 7 (incident procedures/ownership) satisfy their documentation-deliverable requirements.
This does not establish production enforcement or provider measurements. The production control
plane, worker adapter and operating APIs remain follow-up implementation work. Required provider
proofs, execution/interruption/resume/cleanup, usage/cost measurements and integrated attack validation
cannot be replaced with follow-up tracking.

See [parallel experiments and limitations](parallel-results.md),
[VM lifecycle](evidence/vm-lifecycle-linux.json),
[initial lifecycle failures](evidence/vm-lifecycle-initial-linux.json) and
[MCP measurements](evidence/vm-mcp-linux.json). Preserve the initial CLI SDK Agent-tool failure and
the VM shutdown exceeding the 20-second wait. The successful rerun used the actual CLI `/agent`
projection and a 60-second bounded shutdown. Short tests do not establish long-running stability.
Company rights-holder, license, package-author and physical-checkout relocation decisions were
reserved by the owner separately from this research.

Cloud resource creation and credential use require authorization plus a temporary
account/profile/region. An unanswered request is not approval. Follow-up implementation covers
runtime hosting, worker sandbox adapters, organization identity/delegation/policy, parallel
journal/recovery and remote UI/authentication.

## Follow-up implementation areas

- Hosted runtime and mandatory isolation admission.
- Task workers, CLI tools and subagent adapters.
- Organization identity, delegation, approval and budget control plane.
- Parallel journals, external consistency, interruption and incident recovery.
- Remote desktop, authentication and session contracts.

These areas still require verified Robota issue mapping. Recording them does not replace the
incomplete provider measurements. Each behavior-changing implementation requires a failing
regression test before the fix and actual integration-path validation. Provider selection follows
the research results.
