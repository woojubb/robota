import type { IAccountRecord } from './accounts/types.js';
import { type IHostConfig, publicOrigin } from './config.js';
import type { IUnitSpec } from './runtime/port.js';

/** What the runtime is asked to build for an account; carries no secret. */
export function unitSpecOf(
  record: IAccountRecord,
  config: IHostConfig,
  installId: string,
): IUnitSpec {
  return {
    account: record.id,
    installId,
    image: record.imageId,
    subnetSlot: record.subnetSlot,
    limits: record.limits,
    hostname: record.hostname,
    publicOrigin: publicOrigin(config, record.hostname),
    provider: record.provider,
  };
}
