import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

/**
 * Lazy loader for the default node catalog (ARCH-PROVIDER-004). The catalog lives in
 * `@robota-sdk/dag-nodes-default` (an entry-point-only composition aggregator); `dag-framework` keeps NO hard
 * concrete-node dependency and loads it via a dynamic `import()` only when `createDagFramework()` is called
 * without an injected `options.nodes`. A load failure surfaces a **typed diagnostic naming the package**
 * (mirroring Stage B's provider-set loader), never a silent empty registry.
 */
interface IDagNodesDefaultModule {
  createDefaultNodeRegistry: (
    providers?: readonly IProviderDefinition[],
  ) => Promise<IDagNodeDefinition[]>;
  createDefaultNodeRegistrySync: () => IDagNodeDefinition[];
}

async function importDagNodesDefault(): Promise<IDagNodesDefaultModule> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- lazy default catalog; keeps dag-framework node-dep-free
    return (await import('@robota-sdk/dag-nodes-default')) as IDagNodesDefaultModule;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Failed to load the default DAG node catalog. Install @robota-sdk/dag-nodes-default (and its node ' +
        'packages), or pass createDagFramework({ nodes: [...] }) / an explicit nodeRegistry. Cause: ' +
        cause,
    );
  }
}

/** The full async default catalog, with the collapsed `llm-text` node bound to `providers` (or the lazy default set). */
export async function loadDefaultNodeRegistry(
  providers?: readonly IProviderDefinition[],
): Promise<IDagNodeDefinition[]> {
  const mod = await importDagNodesDefault();
  return mod.createDefaultNodeRegistry(providers);
}

/** The SDK-free base node set (async wrapper — the catalog is loaded via dynamic import). */
export async function loadDefaultNodeRegistrySync(): Promise<IDagNodeDefinition[]> {
  const mod = await importDagNodesDefault();
  return mod.createDefaultNodeRegistrySync();
}
