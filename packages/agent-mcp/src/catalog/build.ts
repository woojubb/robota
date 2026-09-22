/**
 * Builds an {@link IMCPCatalog} from what each configured server discovered (MCP-002).
 *
 * This is the ONE place that decides exposure: every discovered tool/prompt/resource ends up in
 * exactly one of `adopted`, `adapted` or `rejected` — never silently dropped
 * (`enforcement-architecture.md`, "Silence is not success"). Naming and its collisions are owned by
 * `./naming.ts`; CORE-040 schema narrowing is owned by `../third-party-schema.ts`. This module only
 * sequences them: name first, resolve collisions, THEN narrow and report — narrowing a tool that a
 * collision will reject anyway would run CORE-040 for an entry nobody will ever call.
 */

import { narrowToUniversalSubset } from '../third-party-schema.js';
import { canonicalName, resolveNameCollisions } from './naming.js';

import type { TUnenforceableSchemaReporter } from '../third-party-schema.js';
import type { ICanonicalNameResult, INameCollisionLoser } from './naming.js';
import type {
  IMCPCatalog,
  IMCPCatalogPromptEntry,
  IMCPCatalogProvenance,
  IMCPCatalogRejection,
  IMCPCatalogResourceEntry,
  IMCPCatalogServerEntry,
  IMCPCatalogToolEntry,
  IMCPDiscoveredPromptArgument,
  IMCPDiscovery,
  TMCPCapabilityDomain,
  TMCPCapabilityState,
  TMCPCatalogEntry,
} from './types.js';
import type { IParameterSchema } from '@robota-sdk/agent-core';

/**
 * What this unit accepts as a server's transport. Only `streamable-http` and `stdio` are MCP's
 * standard transports (`../transport.ts`'s own scope); `sse` and `ws` are named here ONLY so a
 * caller can hand them in and receive a reasoned rejection back rather than a type error.
 */
export type TMCPCatalogInputTransport = 'streamable-http' | 'stdio' | 'sse' | 'ws';

/** One server's contribution to the catalog. `discovery` is absent when it was never opened. */
export interface IMCPCatalogInput {
  readonly serverId: string;
  readonly origin: string;
  readonly transport: TMCPCatalogInputTransport;
  readonly discovery?: IMCPDiscovery;
}

export interface IBuildCatalogOptions {
  readonly report?: TUnenforceableSchemaReporter;
}

/**
 * Transports `IMCPCatalogServerEntry.transport` (`./types.ts`, not owned here) can express. A
 * server outside this set is refused before a `servers[]` entry is even considered — see the
 * module doc below for why.
 */
type TMCPServerEntryTransport = IMCPCatalogServerEntry['transport'];

function isServerEntryTransport(
  transport: TMCPCatalogInputTransport,
): transport is TMCPServerEntryTransport {
  return transport === 'streamable-http' || transport === 'stdio';
}

interface IPendingBase {
  readonly key: string;
  readonly serverId: string;
  readonly sourceName: string;
  readonly namingResult: ICanonicalNameResult;
  readonly provenance: IMCPCatalogProvenance;
  readonly description?: string;
}

interface IPendingTool extends IPendingBase {
  readonly kind: 'tool';
  readonly inputSchema: IParameterSchema;
}

interface IPendingPrompt extends IPendingBase {
  readonly kind: 'prompt';
  readonly promptArguments: readonly IMCPDiscoveredPromptArgument[];
}

interface IPendingResource extends IPendingBase {
  readonly kind: 'resource';
  readonly uri: string;
  readonly mimeType?: string;
}

type TPendingItem = IPendingTool | IPendingPrompt | IPendingResource;

/** Combines the naming reason with whether schema narrowing dropped anything, per TC-18. */
function combineReasons(namingReason: string | undefined, narrowed: boolean): string | undefined {
  const parts: string[] = [];
  if (namingReason) parts.push(namingReason);
  if (narrowed) parts.push('narrowed');
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function emptyCapabilities(): Readonly<Record<TMCPCapabilityDomain, TMCPCapabilityState>> {
  const unsupported: TMCPCapabilityState = { kind: 'unsupported' };
  return { tools: unsupported, prompts: unsupported, resources: unsupported };
}

function capabilitiesOf(
  discovery: IMCPDiscovery | undefined,
): Readonly<Record<TMCPCapabilityDomain, TMCPCapabilityState>> {
  if (!discovery) return emptyCapabilities();
  return {
    tools: discovery.tools.state,
    prompts: discovery.prompts.state,
    resources: discovery.resources.state,
  };
}

function rejectedTransportEntry(input: IMCPCatalogInput): IMCPCatalogRejection {
  // A deprecated/unsupported transport is a refusal, not a fallback. It is NOT also recorded
  // in `servers[]`: `IMCPCatalogServerEntry.transport` (`./types.ts`, not owned by this unit)
  // is typed to exactly the two supported transports, so there is no honest value to put there
  // for a server that was never allowed to speak one of them — the spec's own TC-07 asserts
  // only the `rejected` bucket for this case (§ Decision, "rejected transports are refusals").
  return {
    kind: 'server',
    serverId: input.serverId,
    name: input.serverId,
    reason: `transport ${input.transport} is not supported: MCP standard transports are stdio and Streamable HTTP`,
  };
}

function buildServerEntry(
  input: IMCPCatalogInput,
  transport: TMCPServerEntryTransport,
  discovery: IMCPDiscovery | undefined,
): IMCPCatalogServerEntry {
  return {
    serverId: input.serverId,
    origin: input.origin,
    transport,
    identity: discovery?.identity,
    instructions: discovery?.instructions,
    capabilities: capabilitiesOf(discovery),
  };
}

function buildProvenance(input: IMCPCatalogInput, discovery: IMCPDiscovery): IMCPCatalogProvenance {
  return {
    serverId: input.serverId,
    serverName: discovery.identity.serverName,
    serverVersion: discovery.identity.serverVersion,
    protocolVersion: discovery.identity.protocolVersion,
    origin: input.origin,
  };
}

function collectPendingTools(
  serverId: string,
  discovery: IMCPDiscovery,
  provenance: IMCPCatalogProvenance,
): IPendingTool[] {
  const items: IPendingTool[] = [];
  if (discovery.tools.state.kind === 'supported') {
    for (const tool of discovery.tools.items) {
      items.push({
        kind: 'tool',
        key: `${serverId}::tool::${tool.name}`,
        serverId,
        sourceName: tool.name,
        description: tool.description,
        namingResult: canonicalName(serverId, tool.name),
        provenance,
        inputSchema: tool.inputSchema,
      });
    }
  }
  return items;
}

function collectPendingPrompts(
  serverId: string,
  discovery: IMCPDiscovery,
  provenance: IMCPCatalogProvenance,
): IPendingPrompt[] {
  const items: IPendingPrompt[] = [];
  if (discovery.prompts.state.kind === 'supported') {
    for (const prompt of discovery.prompts.items) {
      items.push({
        kind: 'prompt',
        key: `${serverId}::prompt::${prompt.name}`,
        serverId,
        sourceName: prompt.name,
        description: prompt.description,
        namingResult: canonicalName(serverId, prompt.name),
        provenance,
        promptArguments: prompt.arguments ?? [],
      });
    }
  }
  return items;
}

function collectPendingResources(
  serverId: string,
  discovery: IMCPDiscovery,
  provenance: IMCPCatalogProvenance,
): IPendingResource[] {
  const items: IPendingResource[] = [];
  if (discovery.resources.state.kind === 'supported') {
    for (const resource of discovery.resources.items) {
      items.push({
        kind: 'resource',
        key: `${serverId}::resource::${resource.name}`,
        serverId,
        sourceName: resource.name,
        description: resource.description,
        namingResult: canonicalName(serverId, resource.name),
        provenance,
        uri: resource.uri,
        mimeType: resource.mimeType,
      });
    }
  }
  return items;
}

/** Records every collision loser as a `rejected` entry; a winner with no pending item is skipped. */
function applyCollisionRejections(
  pendingByKey: ReadonlyMap<string, TPendingItem>,
  losers: readonly INameCollisionLoser[],
  rejected: IMCPCatalogRejection[],
): void {
  for (const loser of losers) {
    const item = pendingByKey.get(loser.key);
    if (!item) continue;
    rejected.push({
      kind: item.kind,
      serverId: item.serverId,
      name: loser.name,
      reason: loser.reason,
    });
  }
}

function buildToolEntry(
  item: IPendingTool,
  canonical: string,
  options: IBuildCatalogOptions | undefined,
): IMCPCatalogToolEntry {
  // Narrowing runs ONCE, here, at registration — never again for this tool (`createDiscoveredTool`
  // reuses `schema` as-is). Only WINNING tools reach this: a tool a collision rejected never pays
  // for narrowing, and its reporter is never told about paths nobody will enforce.
  const narrowed = narrowToUniversalSubset(item.inputSchema);
  if (narrowed.unenforceable.length > 0) {
    options?.report?.(canonical, narrowed.unenforceable);
  }
  const reason = combineReasons(item.namingResult.reason, narrowed.unenforceable.length > 0);
  return {
    kind: 'tool',
    canonicalName: canonical,
    sourceName: item.sourceName,
    description: item.description,
    schema: narrowed.schema,
    unenforceablePaths: narrowed.unenforceable,
    provenance: item.provenance,
    disposition: reason ? 'adapted' : 'adopted',
    reason,
  };
}

function buildPromptEntry(item: IPendingPrompt, canonical: string): IMCPCatalogPromptEntry {
  const reason = combineReasons(item.namingResult.reason, false);
  return {
    kind: 'prompt',
    canonicalName: canonical,
    sourceName: item.sourceName,
    description: item.description,
    arguments: item.promptArguments,
    provenance: item.provenance,
    disposition: reason ? 'adapted' : 'adopted',
    reason,
  };
}

function buildResourceEntry(item: IPendingResource, canonical: string): IMCPCatalogResourceEntry {
  const reason = combineReasons(item.namingResult.reason, false);
  return {
    kind: 'resource',
    canonicalName: canonical,
    uri: item.uri,
    sourceName: item.sourceName,
    description: item.description,
    mimeType: item.mimeType,
    provenance: item.provenance,
    disposition: reason ? 'adapted' : 'adopted',
    reason,
  };
}

function buildEntryForPendingItem(
  item: TPendingItem,
  canonical: string,
  options: IBuildCatalogOptions | undefined,
): TMCPCatalogEntry {
  if (item.kind === 'tool') {
    return buildToolEntry(item, canonical, options);
  }
  if (item.kind === 'prompt') {
    return buildPromptEntry(item, canonical);
  }
  return buildResourceEntry(item, canonical);
}

/**
 * @param inputs - one entry per configured server, whether or not it ever opened
 * @param options - `report`, told once per tool whose schema carries an unenforceable subtree
 */
export function buildCatalog(
  inputs: readonly IMCPCatalogInput[],
  options?: IBuildCatalogOptions,
): IMCPCatalog {
  const servers: IMCPCatalogServerEntry[] = [];
  const rejected: IMCPCatalogRejection[] = [];
  const pending: TPendingItem[] = [];

  for (const input of inputs) {
    if (!isServerEntryTransport(input.transport)) {
      rejected.push(rejectedTransportEntry(input));
      continue;
    }

    const { discovery } = input;
    servers.push(buildServerEntry(input, input.transport, discovery));

    if (!discovery) continue;

    const provenance = buildProvenance(input, discovery);
    pending.push(...collectPendingTools(input.serverId, discovery, provenance));
    pending.push(...collectPendingPrompts(input.serverId, discovery, provenance));
    pending.push(...collectPendingResources(input.serverId, discovery, provenance));
  }

  // Naming and its collisions span every domain and every server together: `canonicalName` does
  // not fold the domain into the name, so a tool and a resource on the same server CAN collide,
  // and that is exactly the "across servers/domains" case this catalog must catch rather than let
  // one silently shadow the other.
  const { winners, losers } = resolveNameCollisions(
    pending.map((item) => ({ key: item.key, name: item.namingResult.name })),
  );

  const pendingByKey = new Map(pending.map((item) => [item.key, item] as const));
  applyCollisionRejections(pendingByKey, losers, rejected);

  const adopted: TMCPCatalogEntry[] = [];
  const adapted: TMCPCatalogEntry[] = [];

  for (const item of pending) {
    const canonical = winners.get(item.key);
    if (canonical === undefined) continue; // recorded as a rejected loser above

    const entry = buildEntryForPendingItem(item, canonical, options);
    (entry.disposition === 'adapted' ? adapted : adopted).push(entry);
  }

  return { servers, adopted, adapted, rejected };
}
