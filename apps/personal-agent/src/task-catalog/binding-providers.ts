/**
 * The host's sources of verified bindings. The agent's own browser is one; a connected service is
 * another, but only for a tool the host has reviewed. What a service says about itself is never read
 * for a binding: its tool names, descriptions and read-only hints are claims, and a binding comes
 * from a table the host wrote after exercising that service, joined with what the person has set up.
 */
import { CONNECTOR_KINDS } from '@robota-sdk/agent-product/personal';

import { issueBinding } from './bindings.js';
import { TaskCatalogRefusedError, oneOf } from './fields.js';
import { READINESS_TEXT } from './readiness-text.js';

import type { IConnectorView, TConnectorKind } from '@robota-sdk/agent-product/personal';
import type { ICapabilityBinding, TBindingSource } from './bindings.js';
import type { IReadinessContext, TBindingBlocker } from './readiness.js';
import type { TEffectCeiling } from './types.js';

const LOCAL_BROWSER_BOUNDARY =
  "https pages the person names, read in the agent's own browser; nothing is submitted";

/**
 * The agent's own browser, which needs no account: `web.read` is bound when a browser can run on
 * this machine, and says the browser is missing when it cannot.
 */
export function localBrowserBindings(options: {
  readonly browserAvailable: () => boolean;
}): IReadinessContext {
  const spec: ICapabilityBinding = {
    capability: 'web.read',
    adapter: 'local-browser',
    argumentBoundary: LOCAL_BROWSER_BOUNDARY,
    effect: 'read-only',
  };
  if (options.browserAvailable())
    return { bindings: [issueBinding(spec)], blockers: [], accounts: [] };
  return {
    bindings: [],
    blockers: [
      {
        capability: spec.capability,
        effect: spec.effect,
        outcome: 'unavailable',
        reason: READINESS_TEXT.localBrowserUnavailable,
      },
    ],
    accounts: [],
  };
}

/**
 * One reviewed tool of one reviewed service. It names the service by its kind and the exact origin of
 * its endpoint, so a service that only calls its tools by the same name, or sits at another address,
 * matches nothing.
 */
export interface IVerifiedConnectorBindingSpec {
  readonly capability: string;
  readonly service: {
    readonly kind: TConnectorKind;
    /** The origin as `new URL(address).origin` spells it, such as `https://mail.example.com`. */
    readonly endpointOrigin: string;
  };
  /** The exact tool, as the service names it. */
  readonly tool: string;
  /** What the host verified the tool does. A service's own claim about it never lowers this. */
  readonly effect: TEffectCeiling;
  readonly argumentBoundary: string;
  /** Scopes the person must have granted for the tool to work; absent when the service has none to grant. */
  readonly requiredScopes?: readonly string[];
}

/**
 * The connector bindings the host has verified. An entry is added only after a service's tool
 * behaviour is reviewed and exercised against that service, so the table is empty until the host has
 * done that for one. A tool's name or its own claims never qualify it.
 */
export const VERIFIED_CONNECTOR_BINDINGS: readonly IVerifiedConnectorBindingSpec[] = [];

/** Refuse a table the host mistyped, before any card is shown from it. */
export function validateConnectorBindingSpecs(
  specs: readonly IVerifiedConnectorBindingSpec[],
): void {
  for (const spec of specs) {
    // A connector binding is issued here once, so the same checks as any binding apply.
    issueBinding({
      capability: spec.capability,
      adapter: 'connector',
      tool: spec.tool,
      argumentBoundary: spec.argumentBoundary,
      effect: spec.effect,
    });
    oneOf(spec.service.kind, `${spec.capability} service kind`, CONNECTOR_KINDS);
    if (!originOf(spec.service.endpointOrigin, true))
      throw new TaskCatalogRefusedError(
        `${spec.capability} service endpointOrigin must be an https origin such as https://mail.example.com`,
      );
    for (const scope of spec.requiredScopes ?? []) {
      if (!/^\S{1,200}$/u.test(scope))
        throw new TaskCatalogRefusedError(
          `${spec.capability} has a required scope that is not a scope word`,
        );
    }
  }
}

/** The origin of an address, or nothing for one that is not an https address; `exact` also demands it be spelled as an origin. */
function originOf(address: string, exact = false): string | undefined {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:') return undefined;
    return exact && url.origin !== address ? undefined : url.origin;
  } catch {
    // allow-fallback: an address that does not parse is not at any reviewed origin.
    return undefined;
  }
}

function candidateOf(
  spec: IVerifiedConnectorBindingSpec,
  view: IConnectorView,
): { binding?: TBindingSource; blocker?: TBindingBlocker } {
  const { connector, status } = view;
  const base = { capability: spec.capability, effect: spec.effect } as const;
  const reconnect: TBindingBlocker = {
    ...base,
    outcome: 'needs-setup',
    step: { type: 'reconnect', connectorId: connector.id, connectorTitle: connector.title },
  };
  if (status.state !== 'connected' || view.tools === undefined) return { blocker: reconnect };
  const granted = new Set((status.scope ?? '').split(' ').filter((scope) => scope !== ''));
  if ((spec.requiredScopes ?? []).some((scope) => !granted.has(scope)))
    return { blocker: reconnect };
  const tool = view.tools.find((offered) => offered.name === spec.tool);
  if (tool === undefined)
    return {
      blocker: {
        ...base,
        outcome: 'unavailable',
        reason: READINESS_TEXT.toolMissing(connector.title, spec.tool),
      },
    };
  // How the agent may call the tool follows the person's decision, else the service's claim. The claim
  // only routes a call: the effect stays the one the host reviewed, so it never makes a write tool read.
  // A tool the host reviewed as a write is allowed only by the person's explicit word.
  const wanted = spec.effect === 'read-only' ? 'read' : 'write';
  const allowed = wanted === 'read' ? tool.access === 'read' : tool.decision === 'write';
  if (!allowed)
    return {
      blocker: {
        ...base,
        outcome: 'needs-setup',
        step: {
          type: 'allow-tool',
          connectorId: connector.id,
          connectorTitle: connector.title,
          tool: spec.tool,
          decision: wanted,
        },
      },
    };
  return {
    binding: issueBinding({
      capability: spec.capability,
      adapter: 'connector',
      account: connector.id,
      tool: spec.tool,
      argumentBoundary: spec.argumentBoundary,
      effect: spec.effect,
    }),
  };
}

/**
 * The reviewed connector tools joined with the person's live connectors. A connector that is
 * connected, has the granted scopes, offers the exact tool and carries the person's decision for it
 * gets a usable binding; any other connector of that service gets the one step that is left. A
 * reviewed service with no connector gets a step to connect it. A connector at another address, of
 * another kind, or with a tool only named like a reviewed one, matches nothing.
 */
export function connectorBindings(options: {
  readonly specs: readonly IVerifiedConnectorBindingSpec[];
  readonly views: readonly IConnectorView[];
}): IReadinessContext {
  validateConnectorBindingSpecs(options.specs);
  const bindings: TBindingSource[] = [];
  const blockers: TBindingBlocker[] = [];
  const titled = new Map<string, string>();
  for (const spec of options.specs) {
    const matching = options.views.filter(
      (view) =>
        view.connector.kind === spec.service.kind &&
        originOf(view.connector.endpoint) === spec.service.endpointOrigin,
    );
    if (matching.length === 0) {
      blockers.push({
        capability: spec.capability,
        effect: spec.effect,
        outcome: 'needs-setup',
        step: { type: 'connect', kind: spec.service.kind },
      });
      continue;
    }
    for (const view of matching) {
      titled.set(view.connector.id, view.connector.title);
      const { binding, blocker } = candidateOf(spec, view);
      if (binding !== undefined) bindings.push(binding);
      if (blocker !== undefined) blockers.push(blocker);
    }
  }
  return {
    bindings,
    blockers,
    accounts: [...titled].map(([id, title]) => ({ id, title })),
  };
}

/** What a reviewed service's tools are when the person's connectors cannot be read: unusable, and why. */
export function unreadableConnectorBindings(
  specs: readonly IVerifiedConnectorBindingSpec[],
): IReadinessContext {
  return {
    bindings: [],
    blockers: specs.map((spec) => ({
      capability: spec.capability,
      effect: spec.effect,
      outcome: 'unavailable' as const,
      reason: READINESS_TEXT.connectorsUnreadable,
    })),
    accounts: [],
  };
}
