# Reviewable cloud PoC experiment plan

Status: execution approval and a temporary account setup are required. No real cloud resources have
been created and no account tokens have been read so far. This is a plan to create and clean up only
the experiment resources below, and company production assets are not used. The local KVM experiment
is performed first and does not substitute for cloud results.

## Resources and scope

| Service      | Maximum experiment resources                                                                                         | Time and data limits                                                                  | Purpose and cleanup                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fly Machines | 1 temporary app, 1 runtime Machine (2 shared vCPU/2GB), and if needed 1 volume of 1GB                                | up to 60min of running, a single approved region, synthetic repo + generated CLI only | Verify headless/daemon, session, stop/start, and volume recovery; remove only that app/VM/volume and re-query                                      |
| Sprites      | 2 synthetic task workers, up to 2 checkpoints per task                                                               | up to 30min per task execution, target of 1GB or less of disk each                    | Verify cross-task, egress, checkpoint, kill/restore, and broker approval; delete by resource ID and check retained checkpoints                     |
| E2B          | 2 workers, up to 2 snapshots                                                                                         | within the Hobby limit, 30min or less each, SDK/template pinned                       | Run the same attacks against the existing adapter's shell/file/Git/child/pause/connect; clean up sandboxes/snapshots and cross-check usage         |
| AWS Lambda   | 1 temporary ordinary function, 1 dedicated minimal IAM role, 1 restricted log group; 1 separate MicroVM if supported | function invocation timeout 60s, concurrency 1, up to 30 invocations; MicroVM 30min   | Verify a short-trigger baseline, environment reuse, and permission exposure; check for leftovers via the IAM/function/log/image/snapshot inventory |

New paid subscriptions, public app URLs, dedicated IPs, production network connections, real
payments or deployments, and writes to real repositories are not included. If an account limitation
requires a plan change or broader permissions, stop the current experiment and decide the specific
change separately. If the expected incremental usage exceeds US$10 in total, or the rate cannot be
confirmed, the next resource is not created. US$10 is not yet an approved budget but a proposed
limit. Because of provider billing delay, this local admission limit is not claimed to be a real-time
invoice hard cap.

## Credential handling

The owner prepares a new temporary organization/account and a minimum-privilege session. Actual token
values are not pasted into chat, documents, or issues. Reading credentials and creating resources use
only the corresponding temporary profile after explicit approval. Provider management credentials are
kept only in the control plane and are not injected into the VM/worker environment or snapshots.
Business APIs use synthetic credentials and an external side-effect surrogate.

AWS requires a dedicated account/role that does not change existing production IAM. The minimum
create/manage/delete permissions are restricted by the experiment resource name prefix and region,
and the ordinary function execution role has only the needed log access. Creating a role and pass-role
widen permissions, so the owner's execution approval is obtained. If Fly/E2B global tokens cannot be
restricted to a minimum scope, that risk is recorded and the experiment account is separated.
Unsupported capabilities are recorded as skip-with-reason and are not counted as successes.

## Common experiment sequence and verdicts

1. Configure the runtime and workers with a pinned artifact, a temporary repo, synthetic runtime secrets, and different per-task canaries.
2. Run the actual headless CLI and daemon, and perform shell/read/write/Git/child subagent/abort.
3. Verify the identity, scope, TTL, re-delegation, and revocation of two actors. From each worker, attempt access to another task/runtime/metadata
   and the admin API, and probe for secrets/env/Unix sockets/host mounts.
4. Verify default-deny egress with DNS, raw IP, redirects, proxy bypass, and existing connections.
5. Verify exact request approval for synthetic payment/deploy operations, approval replay, argument tamper, and use by another actor,
   and trigger concurrent duplicate/retry/crash-after-effect/unknown response.
6. Cause shared-state CAS, lease fencing, and merge conflicts. Confirm the budget, task-count and process/time/memory
   limits, and that after an emergency stop all descendants, connections, and broker admission are rejected.
7. Confirm that revoked identity/approval/budget do not come back in checkpoint -> revoke -> restore.
   Reject a host fallback or an empty-worker success on a corrupted/missing snapshot and a provider outage.
8. Confirm that secret canaries are absent from the audit, and that event tamper/deletion/reordering are detected by the independent anchor.
9. Measure the latency, resource usage, and cost of each start/stop/resume/delete, and prove cleanup with a resource list.

Each record preserves expected/observed/result and the retry count. Failed experiments are kept;
they are never deleted to leave only successful re-runs. The mock HTTP provider is used to exercise the actual
CLI/tool path and does not prove the safety of an adversarial model itself. Every completion
criterion is checked separately in completion-audit, and if there are services that could not be run
or real cost measurement remains, the whole research is not marked complete.
