import {
  shouldRunStartupCliUpdateCheck,
  getStartupCliUpdateNotice,
  formatCliUpdateNotice,
} from '@robota-sdk/agent-framework';
import type { IStartupUpdatePolicyOptions } from './args-to-options.js';

export function resolveStartupUpdateNotice(
  version: string,
  policy: IStartupUpdatePolicyOptions,
): Promise<string | undefined> | undefined {
  if (!shouldRunStartupCliUpdateCheck(policy)) return undefined;
  return getStartupCliUpdateNotice({ currentVersion: version }).then((n) =>
    n ? formatCliUpdateNotice(n) : undefined,
  );
}
