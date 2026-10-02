import { activationIdentity } from '@robota-sdk/agent-mcp';
import type { IMCPResolvedEntry } from '@robota-sdk/agent-mcp';
import type { IContributionDescriptor } from '@robota-sdk/agent-framework';

/** Describe one resolved configuration generation without exposing credentials or admitting it. */
export function describeMcpContribution(
  entry: IMCPResolvedEntry,
): IContributionDescriptor | undefined {
  const identity = activationIdentity(entry);
  const definition = entry.definition;
  if (!identity || !definition || entry.status !== 'resolved') return undefined;
  const supported = definition.transport === 'stdio' || definition.transport === 'http';
  const requiredCapabilities = [
    'mcp-client',
    ...(definition.transport === 'stdio'
      ? ['stdio-authority']
      : definition.transport === 'http'
        ? ['http-transport']
        : []),
  ];
  return {
    schemaVersion: 1,
    identity: entry.name,
    installedRevision: identity.definitionFingerprint,
    generation: JSON.stringify([identity.securityIdentity, identity.definitionFingerprint]),
    source: { kind: 'mcp', location: entry.origin },
    requiredCapabilities,
    contributions: [
      {
        identity: `${entry.name}:mcp:${entry.name}`,
        kind: 'mcp',
        source: entry.origin,
        requiredCapabilities,
        disposition: supported ? 'supported' : 'unsupported',
        ...(supported ? {} : { reason: 'Unsupported MCP transport' }),
      },
    ],
    lifecycle: { activation: 'unadmitted', activeCalls: 'host-owned' },
    diagnostics: supported ? [] : [{ component: 'mcp', code: 'unsupported-transport' }],
  };
}
