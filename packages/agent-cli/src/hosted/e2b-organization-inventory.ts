import { Sandbox, SandboxNotFoundError } from 'e2b/dist/index.mjs';
import type { SandboxInfo } from 'e2b/dist/index.mjs';
import { decodeHostedIdentity, identifier, positiveInteger } from './hosted-runtime-config.js';
import type { IHostedOrganizationInventory, IHostedOrganizationWorker } from './hosted-organization-control.js';

/** Provider-backed inventory, including paused workers. Its management capability stays outside every worker. */
export function createE2BOrganizationInventory(options: {
  readonly apiKey: string;
  readonly controlPlane: string;
  readonly tenant: string;
  readonly requestTimeoutMs?: number;
}): IHostedOrganizationInventory {
  const controlPlane = identifier(options.controlPlane, 'organization control plane');
  const tenant = identifier(options.tenant, 'organization tenant');
  const request = {
    apiKey: identifier(options.apiKey, 'E2B management credential'),
    requestTimeoutMs: positiveInteger(options.requestTimeoutMs ?? 10_000, 'E2B request timeout', 30_000),
    apiUrl: 'https://api.e2b.app', sandboxUrl: 'https://sandbox.e2b.app', domain: 'e2b.app', debug: false, retries: 0,
  };
  function owned(info: SandboxInfo): IHostedOrganizationWorker {
    if (info.metadata.organizationControlPlane !== controlPlane || info.metadata.tenant !== tenant)
      throw new Error('Organization inventory ownership mismatch');
    return Object.freeze({
      resource: identifier(info.sandboxId, 'organization worker'),
      grantId: identifier(info.metadata.organizationGrant, 'organization grant'),
      epoch: positiveInteger(Number(info.metadata.epoch), 'organization epoch'),
      identity: decodeHostedIdentity({ tenant: info.metadata.tenant, task: info.metadata.task, rootTask: info.metadata.rootTask, actor: info.metadata.actor, runtime: info.metadata.runtime }),
    });
  }
  return {
    async list(signal) {
      const paginator = Sandbox.list({ ...request, query: { metadata: { organizationControlPlane: controlPlane, tenant }, state: ['running', 'paused'] }, limit: 100 });
      const workers: IHostedOrganizationWorker[] = [];
      const seen = new Set<string>();
      while (paginator.hasNext) {
        signal.throwIfAborted();
        for (const info of await paginator.nextItems({ ...request, signal })) {
          const worker = owned(info);
          if (seen.has(worker.resource) || workers.length >= 10_000) throw new Error('Organization inventory is incomplete');
          seen.add(worker.resource); workers.push(worker);
        }
      }
      return workers;
    },
    async terminate(worker, signal) {
      signal.throwIfAborted();
      let info: SandboxInfo;
      try { info = await Sandbox.getInfo(worker.resource, { ...request, signal }); }
      catch (error) { if (error instanceof SandboxNotFoundError) return; throw new Error('Organization cleanup is unresolved'); }
      const current = owned(info);
      if (current.grantId !== worker.grantId || current.epoch !== worker.epoch ||
        Object.entries(worker.identity).some(([key, value]) => current.identity[key as keyof typeof current.identity] !== value))
        throw new Error('Organization cleanup ownership mismatch');
      // Do not abort away the deletion receipt; the SDK request timeout still bounds the call.
      await Sandbox.kill(worker.resource, request);
    },
  };
}
