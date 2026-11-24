/**
 * The context the catalog reads readiness from, built afresh each time the list is shown: the agent's
 * own browser as it is now, and the person's connectors as they are now, joined with the table of
 * tools the host has verified. Nothing is kept between calls, so signing in, deciding a tool or
 * disconnecting changes the next answer without a restart.
 */
import {
  connectorBindings,
  localBrowserBindings,
  unreadableConnectorBindings,
  validateConnectorBindingSpecs,
} from './binding-providers.js';
import { mergeReadinessContexts } from './readiness.js';

import type { IConnectorView } from '@robota-sdk/agent-product/personal';
import type { IVerifiedConnectorBindingSpec } from './binding-providers.js';
import type { IReadinessContext } from './readiness.js';

export interface IReadinessSources {
  /** Whether the agent's own browser can run on this machine right now. */
  readonly browserAvailable: () => boolean;
  /** The tools the host verified; a table the host got wrong is refused here, not when a card is shown. */
  readonly connectorBindingSpecs: readonly IVerifiedConnectorBindingSpec[];
  /** The person's connectors as they stand; asked only when the host has verified a tool to join them to. */
  readonly connectorViews: () => Promise<readonly IConnectorView[]>;
}

export function createReadinessContextSource(
  sources: IReadinessSources,
): () => Promise<IReadinessContext> {
  validateConnectorBindingSpecs(sources.connectorBindingSpecs);
  return async () => {
    const local = localBrowserBindings({ browserAvailable: sources.browserAvailable });
    if (sources.connectorBindingSpecs.length === 0) return local;
    let views: readonly IConnectorView[];
    try {
      views = await sources.connectorViews();
    } catch {
      // allow-fallback: connectors that cannot be read right now are shown as unusable, not as an error page.
      return mergeReadinessContexts(
        local,
        unreadableConnectorBindings(sources.connectorBindingSpecs),
      );
    }
    return mergeReadinessContexts(
      local,
      connectorBindings({ specs: sources.connectorBindingSpecs, views }),
    );
  };
}
