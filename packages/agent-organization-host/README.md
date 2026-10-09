# @robota-sdk/agent-organization-host

Private workspace SDK for an operator-owned organization broker, signed workload/request/approval contracts, durable hierarchical budget reservations, fenced task/Git state and independently anchored metadata audit. The CLI exports an owner-hosted company composition using this SDK; local integration does not establish a deployed company's security. npm publication remains disabled.

## Owner integration

1. Run the broker outside worker containers, mount its policy directory only in that control plane, and pin public keys from separate workload and operator-approval issuers. This package accepts neither issuer private keys nor a worker-selected issuer.
2. Use an absolute, private policy path in an owner-only directory. `create: true` is explicit, exclusive first-time initialization. Normal reopen refuses missing, corrupt or unsupported policy. Close existing brokers before explicitly opening an existing v1/v2 journal with `upgrade: true`; the v3 migration preserves its grants, epochs, stops, revocations, replay evidence, operations and accounting. Keep its database, WAL and SHM together and keep them out of worker checkpoints.
3. Through trusted owner code, initialize global/tenant/task budgets and register externally signed grants with `OrganizationLedger`. Never expose those methods as worker/model tools or public routes.
4. Install an `OrganizationAudit` with an owner-pinned stream/public key, an external append-only sink and a separately retained checkpoint anchor. `createOrganizationAuditHttpPorts` connects owner-authenticated sink and anchor services; signatures and hash history are still verified by `OrganizationAudit`. Pass `hosted: true` to `OrganizationBroker` to require both this audit implementation and the ledger's independently retained `anchor`. Omitting hosted mode explicitly retains the legacy SDK contract. Neither bootstrap nor audit-recovery methods belong on worker ingress. Install actions with owner-validated parameters, allowed roles, explicit approval requirements and trusted upper-bound reservations. Provider ports must enforce the reserved token/cost limits, propagate cancellation and report bounded instrumented usage. They receive the operation digest for external idempotency. A claimed usage receipt from a worker is not trusted instrumentation.
5. Serve `createOrganizationHttpHandler` behind owner-controlled TLS with its audience exactly matching the ledger. Plain HTTP is accepted only for literal loopback fixtures. The handler exposes only `POST /v1/apply`, requires canonical JSON, checks Host and rejects browser Origin; it offers no administrative or approval routes. The host must configure transport limits and connection shutdown.
6. On shutdown, close the broker before the ledger. Coordinate provider/process cancellation and reconcile every pending or unknown operation through its external asset owner before recovering capacity. Owner code can settle an exact unknown external operation with `reconcileExternalOperation(originalRequest, confirmedValue)` only after obtaining asset-owner evidence; it charges the entire retained reservation without restoring authority. This package deliberately has no worker refund or retry route for an uncertain effect.

```ts
import {
  OrganizationAudit,
  OrganizationBroker,
  OrganizationLedger,
  createOrganizationHttpHandler,
} from '@robota-sdk/agent-organization-host';

const ledger = new OrganizationLedger({
  path: operatorPolicyPath,
  audience: operatorAudience,
  workloadPublicKey: pinnedWorkloadPublicKey,
  approvalPublicKey: pinnedOperatorPublicKey,
});
const audit = new OrganizationAudit({
  stream: pinnedAuditStream,
  publicKey: pinnedAuditPublicKey,
  sink: ownerAppendOnlyAuditSink,
  anchor: independentlyRetainedAuditAnchor,
});
const broker = new OrganizationBroker({ ledger, audit, actions: ownerActions });
const handler = createOrganizationHttpHandler({ broker, audience: operatorAudience });
// Attach handler to the owner's HTTPS server; do not put issuer/admin ports on this ingress.
```

Node `>=22.13` with `node:sqlite` is required. Validation currently uses Node 22.14, where native SQLite is experimental; this is not a production stability claim. Missing native capability refuses initialization. The public organization contract is the sole production package dependency, and there is no database fallback. ESM and CommonJS builds are provided; there is no browser export.

## Wire and signing

`organizationCanonical(value)` returns UTF-8 JSON with lexicographically sorted UTF-16 property names and standard JSON string escaping. It accepts JSON primitives, dense arrays and plain objects, safe integer numbers only, valid Unicode, bounded depth/node count and at most 64 KiB. It rejects floats, negative zero, unsafe integers, lone surrogates, cycles, getters, sparse arrays, symbols, dates and other unsupported values. This is a restricted protocol, **not a full RFC 8785 implementation**. HTTP requires exactly these bytes, preventing duplicate-key/alternate-encoding interpretation.

Sign `organizationSigningBytes(domain, claims)` with Ed25519; envelopes contain `claims` and an unpadded canonical base64url `signature`. Domains are `workload`, `request` and `approval`, with independent versioned prefixes. A grant binds tenant, task, actor, role, audience, scope, validity, parent, budget, epoch and a worker proof-of-possession public key. Requests bind their nonce and exact operation. Operator approval binds `organizationOperationDigest(request)`, actor, environment, epoch, expiry and one-use approval ID. Nonce and validity are omitted from that operation digest so a new valid proof can retrieve a completed receipt without repeating its effect.

Delegation is registered by the external workload issuer; child grants cannot broaden the parent, and all ancestors are rechecked. Global/tenant/task/ancestor/leaf token, elapsed-time, micro-unit cost and concurrency reservations commit together. Known usage settles all scopes. An owner-installed action may throw `OrganizationNoEffect(reason, usage)` only after the asset owner proves rollback; its trusted token/cost usage and broker elapsed time are still charged, and the refusal is durable. Worker JSON and ordinary provider errors are not rollback evidence. A trusted preflight refusal before an effect may use `budget-exhausted`; it cannot turn an ambiguous provider failure into rollback evidence. Other failed, timed-out or ambiguous results retain their full reservation. Cancellation polling is nominally bounded by `policyIntervalMs`, but external containment is still required for blocked event loops and noncooperative providers.

## Independently anchored metadata audit

The ledger accepts an independent `IOrganizationLedgerAnchor`. `OrganizationFileLedgerAnchor` provides durable, expected-head CAS in a private owner custody directory separate from the policy DB and all worker checkpoints. Every authority transaction verifies the retained digest; mutations confirm the next checkpoint before the DB commit. Missing or rolled-back policy, unconfirmed writes and crash-held anchor locks require owner recovery. Reopen with a matching authoritative DB backup; never reset or delete the retained head to make an old DB appear valid. Coordinated restoration of both stores cannot be detected by this local adapter, so independent custody and retention remain deployment responsibilities. Anchored stores cannot use the legacy schema-upgrade path.

`OrganizationAudit` verifies an owner-pinned Ed25519 audit signer and stream, a versioned SHA-256 predecessor chain, the exact projected event and a signed checkpoint before advancing an independent anchor. External sink signing bytes are supplied by `organizationAuditSigningBytes`; the SDK does not accept its private key. `organizationAuditGenesis` identifies the explicit owner-created initial history. Missing history or an unavailable anchor is refused rather than bootstrapped from worker input.

The broker passes only a fixed `IOrganizationAuditEvent` to an audit writer: phase, operation digest, pseudonymous tenant/task/actor/grant digests and policy epoch. Parameters, return values, proof/approval payloads, signatures, headers and arbitrary error text are excluded before the adapter is called. Digests support correlation and can reveal guessed low-entropy identifiers; they are not encryption. Custom owner writers must provide the same independently confirmed persistence contract as `OrganizationAudit`.

The sink must supply consistent bounded reads and atomic expected-head appends. The anchor must retain authenticated checkpoints outside the mutable sink/journal, with consistent reads and monotonic compare-and-set. Storage identity, access controls, retention and transport authentication are deployment obligations. A signed checkpoint stored beside a rewritable history cannot establish independent rollback detection. The reference test services use separate local processes and disk files; they are not production services or OS/VM isolation.

A definite `OrganizationAuditAppendConflict` means the sink wrote nothing and permits bounded metadata-append retries. While another writer is anchoring, a valid pending tail is observed until the deadline; it is not automatically published. Other append/CAS errors or lost acknowledgement withhold execution and retain the admission reservation. Dispatch is audited before entering the action. A trusted returned result or no-effect refusal is audited before settling accounting; failure leaves an unknown hold. Unknown-outcome metadata is best effort, since termination or unavailable storage cannot guarantee a final event. Broker shutdown, current-policy rechecks and deadlines still apply while audit confirmation is pending.

`audit.recover()` is owner-only: it validates and anchors an already persisted signed continuation, without resetting history, releasing reservations or retrying effects. `verifyOrganizationAudit(entries, signedStart, independentlyRetainedEnd, pinnedPublicKey, pinnedStream)` rejects mutation, omission, order changes and self-consistent rewrites against the retained checkpoint. A bounded page must fully reach its signed end; operators handle longer histories through retained intermediate signed checkpoints. The audit capability does not detect restoration of the separate authority/accounting database or prove prevention of a compromised audit signer/anchor owner.

## Shared task state and recovery

Trusted owner code creates a resource once with `ledger.createStateResource(tenant, task, resource, initialValue)` and installs `createOrganizationStateActions(ledger, { resource, readRoles, writeRoles, writeRequiresApproval, reservation })`. Worker ingress remains the same signed, authorized, budgeted `POST /v1/apply` path. The owner chooses roles, reservations and write approval policy; workers cannot change them through parameters.

`state.read` takes `{}` and returns `{ revision, value }`. `state.lease` takes `{ expectedRevision, ttlMs }` and returns `{ revision, fence, expiresAt }`; its lifetime is capped at 30 seconds and cannot exceed the request or grant. `state.write` takes `{ expectedRevision, fence, value }`. The server validates the current revision, grant holder, policy epoch, fence and expiry atomically. A live lease cannot be renewed or stolen; after expiry or epoch replacement a new lease advances the fence. A checkpoint containing old lease bytes cannot write through a newer fence.

The state effect and its exact result commit in the same transaction. If acknowledgement is lost, its reservation remains held and worker retries cannot execute again. Trusted owner code may call `ledger.reconcileStateOperation(originalRequest)` to settle only an exact recorded state outcome, charging the entire reserved usage bound when instrumentation was lost. Reconciliation may account for a past effect after revocation or stop; it does not authorize new work. No worker route exposes reconciliation, no absent result is guessed, and this method alone does not prove an external provider/Git effect. Owner accounting inspection remains available after a task stop.

## Owner-controlled Git publication

Provision a private bare Git repository outside every worker mount, pin its absolute executable and branch with `new OrganizationGitAsset({ path, ref, gitPath })`, create the task resource with `{ oid: initialBranchOid }`, and install `createOrganizationGitActions(ledger, { resource, asset, readRoles, writeRoles, reservation })`. The owner imports/validates candidate objects separately; the worker route never accepts a repository path, shell command, remote URL or object upload. Do not expose generic `state.write` or other writers for this resource or target ref. Keep the repository and its object storage exclusively in the asset owner's domain; directory permission/inode checks do not establish a VM boundary.

The installed actions expose `state.read`, `state.lease` and `git.publish`. Publication takes `{ expectedRevision, fence, expectedOid, candidateOid }` and always requires a separate operator approval for that exact operation. Only a commit descending from the current expected head may publish. An owner receipt commit is appended with the candidate's exact tree and parent, so the response's actual published OID intentionally differs from the candidate. This preserves candidate history and authorship without creating a merge or silently rewriting the candidate. Git plumbing uses a closed argument/environment set, disables hooks, signing programs, replacement/graft views, automatic GC and filesystem monitors, and performs one old-OID CAS on the pinned branch. It does not check out or execute candidate code.

A prepared receipt intent commits durably before the Git ref can change. Policy/fence checks and publication dispatch are serialized with the SQL writer lock, but Git and SQLite are **not** one atomic store. If termination occurs after the Git CAS and before SQL commits, the original reservation stays held. Worker retries cannot resume that intent. Trusted owner code calls `ledger.reconcileGitPublication(originalRequest, asset)` only after the exact stored receipt commit is reachable from the owner's current branch; an unreferenced object does not prove publication. Reconciliation advances the recorded state once, charges the full reserved bound and may account for a past effect after stop/revocation without restoring workload authority. A missing/rolled-back ref, lost receipt object or conflicting state remains held for further owner investigation; there is no speculative no-effect refund. Retain incomplete intent objects during owner maintenance/GC.

Per-phase subprocess deadlines are capped at one second; the reservation must cover at least three phase bounds. Synchronous plumbing temporarily blocks the broker event loop. These limits, cooperative cancellation and the SQL writer lock do not establish physical network/process containment or an exact wall-clock stop guarantee after dispatch. Deployment must supply that containment. The repository and journal can still be rolled back by their owner domain; reachability and Git object IDs are local recovery evidence, not an independently anchored or signed audit service. This local publication API does not push to an external Git hosting provider.

## Verification and remaining integration

```sh
pnpm --filter @robota-sdk/agent-organization-host build
pnpm exec vitest run packages/agent-organization-host/src/__tests__/
pnpm --filter @robota-sdk/agent-organization-host typecheck
pnpm --filter @robota-sdk/agent-organization-host lint
```

The tests use generated fixture keys, real local HTTP sockets, independent Node processes, a real disk journal and benign temporary file effects. They cover proof/scope/delegation/approval tampering, replay, concurrent sibling reservations, cancellation, crash after effect, durable pending holds, policy replacement/corruption, schema upgrade and independent Python canonicalization for Korean/emoji/control characters. Two worker-client processes race through two broker processes for the same state lease; broker termination after a committed write exercises disk reopen, no blind retry and exact owner reconciliation. Git tests use disposable bare repositories and real independent worker/broker processes, including broker termination immediately before and after a real ref CAS while the SQL transaction is open. Separate credentials and process roles in these fixtures do not establish OS or VM isolation. The CLI adds local hosted composition, fresh-identity recovery and external-owner reconciliation coverage. Provider attestation/KMS, physical worker/descendant stop, production audit custody, cloud attacks and cost/cleanup remain deployment requirements. See [the contract](docs/SPEC.md) and [the monorepo architecture](../../ARCHITECTURE.md).

Audit integrity references: [AWS log-file integrity validation](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html), [RFC 9162 checkpoint and consistency reasoning](https://www.rfc-editor.org/rfc/rfc9162.html). This private linear hash-chain contract does not implement the certificate-transparency protocol.

Primary protocol/storage references: [Node 22.14 native SQLite](https://nodejs.org/download/release/v22.14.0/docs/api/sqlite.html), [SQLite transaction isolation](https://www.sqlite.org/isolation.html), [RFC 8785 canonicalization](https://www.rfc-editor.org/rfc/rfc8785.html), [Git update-ref CAS](https://git-scm.com/docs/git-update-ref), [Git commit-tree](https://git-scm.com/docs/git-commit-tree).
