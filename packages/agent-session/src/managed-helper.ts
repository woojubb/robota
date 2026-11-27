import { isManagedRunProvider, ManagedHelperProviderError } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

/** Why `auto` mode is refused under a managed provider, and what makes it available. */
export const MANAGED_AUTO_REFUSAL =
  'Auto mode is unavailable under a managed provider: its permission classifier must be built from an explicit model-step helperProvider, and the managed provider must declare isolatesHelperRequests. Configure a helperProvider, or use another permission mode.';

/** A helper serves side requests with chat; a managed provider has none, so it is refused. */
export function assertModelStepHelper(helper: IAIProvider | undefined): void {
  if (helper !== undefined && isManagedRunProvider(helper)) {
    throw new ManagedHelperProviderError((helper as { name: string }).name);
  }
}
