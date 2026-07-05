/**
 * Builds the node catalog the authoring LLM sees, plus the `INodeManifest[]` the deterministic
 * assembler (`buildDagFromPipeline`) uses to wire ports. Both derive from the same node definitions,
 * so the prompt and the assembly never disagree about what nodes exist.
 */
import type { IDagNodeDefinition, INodeManifest } from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';

export type TBuildCatalogResult =
  | { readonly ok: true; readonly manifests: INodeManifest[] }
  | { readonly ok: false; readonly error: string };

/** Derive assembler manifests from a set of node definitions. */
export function buildCatalogManifests(nodeDefinitions: IDagNodeDefinition[]): TBuildCatalogResult {
  const assembly = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assembly.ok) {
    return { ok: false, error: `failed to build node registry: ${assembly.error.message}` };
  }
  return { ok: true, manifests: assembly.value.manifests };
}

function describePorts(ports: INodeManifest['inputs']): string {
  if (ports.length === 0) return '—';
  return ports.map((p) => p.key).join(', ');
}

/**
 * Render a compact, deterministic catalog description for the authoring system prompt. One line per
 * node: type, inputs, outputs, and (when present) a one-line summary.
 */
export function renderCatalogForPrompt(manifests: INodeManifest[]): string {
  const sorted = [...manifests].sort((a, b) => a.nodeType.localeCompare(b.nodeType));
  return sorted
    .map((m) => {
      const inPort = m.defaultInputPort ?? describePorts(m.inputs);
      const outPort = m.defaultOutputPort ?? describePorts(m.outputs);
      return `- ${m.nodeType} (in: ${inPort}; out: ${outPort})`;
    })
    .join('\n');
}
