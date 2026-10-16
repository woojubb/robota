# Parallel organization policy and work-VM measurements

This experiment is not a production organization control plane implementation. Two real KVM workers
each sign with their own synthetic Ed25519 actor key and call a single loopback broker endpoint
through an SSH reverse tunnel. The broker and the external-effect surrogate use different host
processes and SQLite DBs. The issuer private key, upstream credentials, and the delegation, budget
and approval journals are not copied into the guest. Each worker receives only its own restricted
credential. Workload attestation, KMS, OPA, and tenant-wide budgets are not implemented.

## Enforcement points and observations

| Contract                  | Actual enforcement point                                                                             | Observation and limits                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and delegation   | issuer signature, actor proof, scope/TTL, current DB records of all ancestors, and revocation checks | Cross-task requests, a different actor key, an invalid signature, and an expired identity were rejected. The host controller provisions identities, so this is not real workload attestation.                                                               |
| Parent budget aggregation | SQLite BEGIN IMMEDIATE checks and reserves usage across all ancestors                                | When two children simultaneously request 60 each, only 60 of the parent's 100 is used and one gets a 429. A reservation whose external result is unknown is kept. This ledger handles synthetic amounts only.                                               |
| High-impact approval      | A separate issuer-signed approval checked for actor/task/epoch/digest/TTL, plus a unique approval ID | A missing approval, changed arguments, and an approval for the wrong actor on a not-yet-used operation were rejected. A raw agent message is not an approval path.                                                                                          |
| Duplicates and failures   | durable operation reservation + idempotency key at a separate service                                | Concurrent requests got the same receipt and a single external transaction. After the real broker exited with code 72 after the external effect but before the local ack, a retry did not duplicate the transaction or the budget.                          |
| Shared state              | task-bound CAS revision and fence                                                                    | Of two writers, only one updated the revision. An old fence was rejected even when the revision was the latest. Automatic recovery for Git merge/CAS leases is not fully implemented.                                                                       |
| Revocation                | Per-request check of leaf/ancestor records                                                           | A stored old credential and a re-request of a completed operation were rejected after revocation. Revoking the root blocked new admission for descendants. This alone does not prove termination of the VM, processes, or network.                          |
| Audit                     | A metadata hash chain excluding credentials and bodies, with an anchor held by the controller        | Synthetic canaries in real state values and the upstream key were not exposed. Tampering, deletion, and reordering were detected by comparison with the anchor. An independent remote audit service and compromise of the controller itself are unverified. |

[Measured results](evidence/parallel-organization-linux.json),
[broker and external surrogate](poc/organization-broker.py), [experiment driver](poc/parallel-experiment.py),
[guest client](poc/guest-broker-client.mjs).

## Signature representation contract

Python and Node share UTF-8 canonical JSON. Schema keys are ASCII and are serialized in lexicographic
order. Only Unicode scalar strings, booleans, null, arrays/objects, and JS safe integers are allowed
as values. Fractions, overflow, unpaired surrogates, and non-ASCII schema keys are rejected. Korean
text and emoji in display names and business strings are allowed. ASCII keys that look like numbers
are also sorted directly, without relying on JSON.stringify's property ordering. This is a limited
research schema contract and is not claimed to be a general JCS standard implementation.
[10 cross-language signature verifications of the two actual functions](evidence/canonical-signing-linux.json).

The initial actor-binding experiment was rejected first at the idempotency-conflict of an existing
operation, so it was not evidence for the approval-actor guard. The corrected experiment sends an
actor-a approval and an actor-b proof for an unused operation and confirms 403/approval-binding and
zero external effects. The initial Unicode representation mismatch was also reproduced in review and
was fixed with a shared byte contract for the actual Python/Node functions and a cross-language
regression.

## Reproduction and retention

First prepare worker-a/b on ports 22243/22244 with the [KVM recipe](poc/vm-recipe.md). The controller
needs Python 3.11 or later and cryptography, and the guest needs only Node 22 and SSH. No existing
company credentials are used. The driver creates ephemeral signing keys and DBs in a separate
temporary directory, and cleans up its own request files, the broker/effect processes, and the SSH
tunnels in finally. In the default mode the VMs are cleaned up in a separate lifecycle experiment,
and in recovery mode the VMs it restarted itself are also terminated. No credentials, private keys,
or request bodies are put into stdout or the report.

```sh
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/parallel-experiment.py \
  --vm-dir "$TASK_VM_DIR" --output "$TASK_VM_DIR/parallel-results.json"
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/check-canonical.py \
  --node "$(command -v node)" --output "$TASK_VM_DIR/canonical-results.json"
```

The only reverse forward allowed to the guest is the broker's /apply, and no issuer/admin endpoint is
provided. Provider management APIs, real company payment/deployment APIs, and a DNS/raw-IP policy
gateway are not connected. When an external API whose result is unknown does not support idempotency,
this approach cannot retry automatically and a separate reconciliation owner is needed. Cloud
invoices, long-duration reliability, process/token/time budgets, connecting the production CLI to a
task-bound worker API, and an integrated restore/revoke path on a cloud provider remain to be
verified. The extended experiment below verifies the integrated path on the local reference topology.

The measured controller was Python 3.14.4 with cryptography 46.0.5. Three HTTP requests containing
an invalid canonical domain were also rejected without privileged effects and left a safe metadata
audit. [Rejection/audit results](evidence/broker-invalid-domain-linux.json),
[reproduction](poc/probe-invalid-domain.py).

## Real revocation, disk restore, and external-result-unknown reinforcement

The [extended measurement](evidence/parallel-recovery-linux.json) confirms 24 observation records
over the same two guests/control journal. `--with-vm-recovery` stores a normally approved actor job
and the private actor credential on the worker's own disk, then creates an offline checkpoint. It
revokes the identity of the running worker and stops the actual child process, the SSH tunnel of the
open broker TCP connection, and the VM. After verifying the checkpoint digest and restoring the disk,
the old identity file really did come back, yet the request got 403/revoked-or-epoch. A request
recovered with a new signing key/leaf epoch and scope succeeded, and the parent ledger outside the
snapshot was 81, the 80 already spent plus the new 1. This is an integrated revocation/recovery
experiment on the local reference topology and is not a verification of the production CLI, cloud, or
a tenant-wide emergency stop. The `revoked-saved-identity` record presents the rejection response
again after the same restore, so the 24 records are not counted as 24 independent requests or
attacks. The open connection was observed through the guest TCP connection being ready and the
corresponding SSH tunnel ending; it is not the result of querying the provider's full connection
inventory.

A separate surrogate was run in a mode without idempotency, and a response was lost after the effect.
The broker preserved the pending reservation and the single external transaction, and rejected the
re-request with 503/external-reconciliation-required. After the trusted asset owner confirmed the
external receipt and digest outside the worker and settled the journal, it returned the same result
without producing the external effect again. This owner path is the research controller's direct DB
reconciliation; a production approval UI or operations API is a follow-up issue.

The [guard negative control](evidence/unknown-guard-regression-linux.json) used the same signed HTTP
request and a non-idempotent surrogate, and removed only the retry-rejection branch in a temporary
in-memory module. With the current code the result was 503 and one external effect; without that
guard, the retry returned 200 and there were two effects. This observation confirms the condition
under which automatic retry after a lost response actually creates a duplicate effect, and it does
not modify the repository original.

Review reproduced a bug where, if the graceful shutdown of the restored VM times out, the cleanup of
the tunnels and control service after it is also skipped. The corrected driver attempts cleanup of
each resource independently and, after a terminate/kill fallback for its own processes, reports the
error. The [real temporary-process regression](evidence/cleanup-faults-linux.json) confirms, against
the stored pre-fix cleanup AST, that four processes remain alive after an SSH timeout, and confirms
that in the current cleanup's SSH-timeout and worker-wait-timeout cases all four processes are
terminated and the error is reported. This does not substitute for measuring a real QEMU outage or a
provider cleanup failure. The [full two-guest experiment was re-run](evidence/parallel-recovery-repeat-linux.json)
with the corrected driver, again confirming the 24 records and normal process/tunnel cleanup. The
initial extended result is preserved as well.

```sh
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/parallel-experiment.py --with-vm-recovery \
  --vm-dir "$TASK_VM_DIR" --output "$TASK_VM_DIR/parallel-recovery.json"
python3 research/agent-organization-security/poc/git-conflict.py \
  --output "$TASK_VM_DIR/git-conflict.json"
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/check-unknown-guard.py \
  --output "$TASK_VM_DIR/unknown-guard-regression.json"
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/check-cleanup.py \
  --output "$TASK_VM_DIR/cleanup-faults.json"
```

The [real Git experiment](evidence/git-conflict-linux.json) confirms four cases: contention on the
same baseline ref between two task candidates, a stale-baseline retry after the contention, a content
conflict on the same file, and preservation of the candidate/accepted refs after a merge abort. It
uses only a local synthetic repo and does not mean the identity, branch, and lease permissions of a
company Git broker are already implemented.
