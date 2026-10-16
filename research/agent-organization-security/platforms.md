# Platform candidate comparison

Official documentation checked on: 2026-09-30. The lifetimes and prices below are the sources' current
descriptions, and support on a real account, regional pricing, latency, and billing must be confirmed
with a PoC. Guarantees that the sources do not state are not inferred.

| Candidate and purpose                                                | Confirmed properties                                                                                                                                           | Boundaries and operational responsibility                                                                                                                                                 | Measurements still needed                                                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Fly Machines: long-running headless runtime                          | VM contents and application network security are the customer's responsibility. The Machines API provides VM lifecycle                                         | The shell inside the runtime and the runtime key are not automatically separated. The operator protects the app image, auth, permissions, and services                                    | Actual CLI/daemon and WS reconnection, stop/start/suspend, volume state, cleanup, per-region usage                                             |
| Fly Sprites: task worker                                             | Persistent filesystem, checkpoints, and an exec/TTY/service API. The current lifecycle documentation says RAM/processes are not retained after sleep           | A separate Sprite per task and a scoped management permission are needed. A disk restore is not treated as resuming paused instructions                                                   | node/shell/Git/child execution, process termination/restart, file checkpoints, network policy/raw-IP/Unix socket bypass, actual account region |
| E2B: task worker and comparison with the existing SDK adapter        | The provider describes per-session microVM isolation. Currently Hobby is up to 1h session/20 concurrency, and Pro is up to 24h with separate usage             | Confirm the pause/snapshot/connect contract of the actual E2B SDK and the existing adapter. Company approval and delegation are a separate broker                                         | exact SDK version, pause result and resume identity, network deny, revoke after snapshot, timeout/kill/cleanup                                 |
| Lambda ordinary function: short request/trigger                      | Ordinary invocation up to 900s, read-only image root and writable `/tmp`; execution environment reuse                                                          | If the worker command and the function role credential are in the same environment, that is not a business permission boundary. State must not depend on the persistence of local RAM/tmp | Node/child/Git packaging, cold/warm invocation, child/file state after timeout, IAM/metadata access, actual request cost                       |
| Lambda Managed Instances / MicroVMs: additional evaluation candidate | The same current quotas documentation distinguishes some async invocations of Managed Instances at 90min, and ARM64 MicroVMs up to 8h with suspend/resume APIs | The 15min conclusion for ordinary functions is not generalized to the whole Lambda product family. Account/region support and separate permissions/cost need confirmation                 | Whether the new API is accessible, ARM64 CLI artifact, lifecycle/WS/state, and actual billing                                                  |

The detailed capabilities in the table above are based on the following official sources. A provider's
default isolation is not evidence of least privilege for company work, one-time use of approvals, or
trustworthiness between agents.

- [Fly shared responsibility](https://fly.io/docs/security/shared-responsibility/): the virtualization boundary and the customer's responsibility for the image, application, and authentication.
- [Machines API](https://fly.io/docs/machines/api/machines-resource/): the actual lifecycle schema for running, stopping, resuming, and so on.
- [Current Sprites lifecycle](https://docs.fly.io/sprites/working-with-sprites/): filesystem persistence, RAM loss, service restart, and exec/TTY sessions.
- [Sprites checkpoint description](https://fly.io/sprites/): disk checkpoints, distinguished from resuming process instructions.
- [Sprites network policy API](https://sprites.dev/api/sprites/policies): the documented properties of DNS filtering and immediate application. Raw IP, a custom resolver, and existing connections have no guarantee determined until a real attack experiment.
- [E2B security](https://e2b.dev/security), [current product boundary](https://e2b.dev/), [official SDK documentation](https://docs.e2b.dev/).
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html): check the limits of ordinary functions, Managed Instances, and MicroVMs separately.
- [Lambda environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html), [container filesystem](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html).

## Determining state recovery and latency

Sprite sleep/restore does not mean process continuity. If the wording in old search results differs
from the current documentation, write the hypothesis based on the current lifecycle/API and determine
it by measurement. Suspend, pause, checkpoint, and filesystem restore do not have the same meaning
across providers. Measure from the `ready` response to the first actual shell/CLI result, and record
initial provisioning, cold boot, warm wake, and restore separately, at least 3 times each. Do not
carry local VM measurements over as cloud cold-start values.

For WS/sessions, confirm that the runtime server actually performs carrier authentication, token
expiry, reconnect, and session binding. A topology combining a Lambda trigger with a separate
WebSocket gateway must add gateway cost, state, and auth, and do not write that an ordinary function
can host the desktop loopback daemon as is.

## Cost measurement plan

The current [Fly pricing](https://fly.io/pricing/) bills Machine compute by running time, volumes by
provisioned capacity, and egress by GB per region. Sprites shows CPU $0.07/CPU-hour, actual memory
$0.04375/GB-hour, hot storage $0.000683/GB-hour, and retained cold storage $0.000027/GB-hour. Store
the region and unit of the actual API usage and the invoice. Do not assume that sleep/stop ends all
storage cost. Do not mix the selected-region/default-preset prices from different Fly pricing pages.

[E2B pricing](https://e2b.dev/pricing) distinguishes Hobby credits and usage from Pro at
$150/month + usage. If a Pro subscription is needed for the PoC, do not buy a new subscription
automatically and decide it separately. Free credits also do not replace a record of actual usage.
The prices of AWS functions, MicroVMs, logging, storage, and gateways are computed from the official
price list after the actual experiment region and service type are decided.

A measurement record includes provider, region, resource ID, image/SDK version, started/stopped/deleted
times, CPU/RAM/storage/egress/request/log usage, the rate at the time, currency, calculation formula,
invoice lag, and cleanup verification. Model API usage is replaced with a synthetic provider, and
product inference cost is separated from platform execution cost. If there is no real cost data,
mark it as estimated/unmeasured.
