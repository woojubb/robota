import type { IDagDefinition } from '@robota-sdk/dag-core';

export type TNodeStatus = 'pending' | 'running' | 'done' | 'error';

// A flow group = one chunk of lines in the display
type IFlowGroup =
  | { kind: 'root'; nodeId: string }
  | { kind: 'single'; from: string; to: string }
  | { kind: 'fanout'; from: string; targets: string[] }
  | { kind: 'fanin'; sources: string[]; to: string };

export interface IFlowLayout {
  groups: IFlowGroup[];
}

const SPINNER_FRAMES = ['⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function statusIcon(status: TNodeStatus, spinnerFrame = 0): string {
  switch (status) {
    case 'pending':
      return '[ ]';
    case 'running': {
      const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '⠸';
      return `[${frame}]`;
    }
    case 'done':
      return '[✓]';
    case 'error':
      return '[✗]';
    default: {
      const _never: never = status;
      return '[ ]';
    }
  }
}

/**
 * Build a topological order of node IDs using dependsOn relationships.
 * Returns nodeIds in execution order (dependencies first).
 */
function topoSortIds(dag: IDagDefinition): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const nodeIds = dag.nodes.map((n) => n.nodeId);

  function visit(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = dag.nodes.find((n) => n.nodeId === nodeId);
    if (!node) return;
    for (const dep of node.dependsOn) {
      visit(dep);
    }
    result.push(nodeId);
  }

  for (const nodeId of nodeIds) {
    visit(nodeId);
  }

  return result;
}

/**
 * Build a flow layout from a DAG definition.
 * Groups represent chunks of lines in the display.
 */
export function buildFlowLayout(dag: IDagDefinition): IFlowLayout {
  const topoOrder = topoSortIds(dag);

  // Build outgoing and incoming maps from node.dependsOn
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of dag.nodes) {
    if (!outgoing.has(node.nodeId)) outgoing.set(node.nodeId, []);
    if (!incoming.has(node.nodeId)) incoming.set(node.nodeId, []);
  }

  for (const node of dag.nodes) {
    for (const dep of node.dependsOn) {
      const outs = outgoing.get(dep) ?? [];
      if (!outs.includes(node.nodeId)) outs.push(node.nodeId);
      outgoing.set(dep, outs);

      const ins = incoming.get(node.nodeId) ?? [];
      if (!ins.includes(dep)) ins.push(dep);
      incoming.set(node.nodeId, ins);
    }
  }

  const groups: IFlowGroup[] = [];

  // Track which nodes are already part of a fanin group that's been emitted
  const emittedFaninTargets = new Set<string>();
  // Track which fanin groups we've already emitted (to avoid duplicates)
  const pendingFaninTargets = new Set<string>();

  // Pre-compute fanin targets (nodes with multiple incoming)
  const faninTargets = new Set<string>();
  for (const [nodeId, ins] of incoming.entries()) {
    if (ins.length > 1) faninTargets.add(nodeId);
  }

  for (const nodeId of topoOrder) {
    const outs = outgoing.get(nodeId) ?? [];
    const ins = incoming.get(nodeId) ?? [];

    // Check if this node is the last source of a fanin target
    // If so, we should emit a fanin group
    for (const target of outs) {
      if (faninTargets.has(target) && !emittedFaninTargets.has(target)) {
        const targetIncoming = incoming.get(target) ?? [];
        // Check if nodeId is the last source in topo order
        const lastSourceInTopo = topoOrder
          .slice()
          .reverse()
          .find((id) => targetIncoming.includes(id));
        if (lastSourceInTopo === nodeId) {
          // Collect all sources in topo order
          const sources = topoOrder.filter((id) => targetIncoming.includes(id));
          groups.push({ kind: 'fanin', sources, to: target });
          emittedFaninTargets.add(target);
          pendingFaninTargets.add(target);
        }
      }
    }

    if (outs.length === 0 && ins.length === 0) {
      // Standalone root node
      groups.push({ kind: 'root', nodeId });
    } else if (outs.length > 1) {
      // Fan-out node
      groups.push({ kind: 'fanout', from: nodeId, targets: outs });
    } else if (outs.length === 1) {
      const target = outs[0] as string;
      const targetIns = incoming.get(target) ?? [];
      if (targetIns.length > 1) {
        // This node connects to a fanin target — skip single group (fanin handles it)
        // The fanin group will be emitted when we encounter the last source
        // But we already handled that above
      } else {
        // Single connection
        groups.push({ kind: 'single', from: nodeId, to: target });
      }
    } else if (ins.length > 0 && outs.length === 0) {
      // Terminal node - check if it's already included in a single or fanin group
      const alreadyCovered = groups.some((g) => {
        if (g.kind === 'single' && g.to === nodeId) return true;
        if (g.kind === 'fanin' && g.to === nodeId) return true;
        if (g.kind === 'fanout' && g.targets.includes(nodeId)) return true;
        return false;
      });
      if (!alreadyCovered) {
        // Terminal node that is target of fanout - already covered by fanout group
        // If not covered, it will be a solo display. But normally these are covered.
      }
    }
  }

  return { groups };
}

/**
 * Render a flow layout to string lines given node statuses.
 */
export function renderFlowLayout(
  layout: IFlowLayout,
  statuses: ReadonlyMap<string, TNodeStatus>,
  spinnerFrame = 0,
): string[] {
  const lines: string[] = [];

  function getStatus(nodeId: string): TNodeStatus {
    return statuses.get(nodeId) ?? 'pending';
  }

  function icon(nodeId: string): string {
    return statusIcon(getStatus(nodeId), spinnerFrame);
  }

  for (const group of layout.groups) {
    switch (group.kind) {
      case 'root': {
        lines.push(`${icon(group.nodeId)} ${group.nodeId}`);
        break;
      }
      case 'single': {
        lines.push(`${icon(group.from)} ${group.from} ──▶ ${icon(group.to)} ${group.to}`);
        break;
      }
      case 'fanout': {
        const srcIcon = icon(group.from);
        const prefix = `${srcIcon} ${group.from} `;
        const indent = ' '.repeat(prefix.length);
        for (let i = 0; i < group.targets.length; i++) {
          const target = group.targets[i] as string;
          const tgtIcon = icon(target);
          if (i === 0) {
            lines.push(`${prefix}──┬──▶ ${tgtIcon} ${target}`);
          } else if (i < group.targets.length - 1) {
            lines.push(`${indent}├──▶ ${tgtIcon} ${target}`);
          } else {
            lines.push(`${indent}└──▶ ${tgtIcon} ${target}`);
          }
        }
        break;
      }
      case 'fanin': {
        for (let i = 0; i < group.sources.length; i++) {
          const src = group.sources[i] as string;
          const srcIcon = icon(src);
          if (i === group.sources.length - 1) {
            // Last source - show the arrow to target
            const tgtIcon = icon(group.to);
            lines.push(`${srcIcon} ${src} ──┴──▶ ${tgtIcon} ${group.to}`);
          } else if (i === 0) {
            lines.push(`${srcIcon} ${src} ──┐`);
          } else {
            lines.push(`${srcIcon} ${src} ──┤`);
          }
        }
        break;
      }
      default: {
        const _never: never = group;
        break;
      }
    }
  }

  return lines;
}
