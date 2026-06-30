import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  INodeConfigObject,
} from '@robota-sdk/dag-core';

export interface IDagMdMeta {
  readonly description?: string;
  readonly displayName?: string;
  readonly tags?: readonly string[];
}

export interface IDagMdNodeSpec {
  /** nodeType field (also accepts 'type' as alias) */
  readonly nodeType: string;
  readonly config?: Record<string, unknown>;
  /** Explicit output port override for wiring. */
  readonly fromPort?: string;
  /** Explicit input port override for wiring. */
  readonly toPort?: string;
}

export interface IDagMdParseResult {
  readonly ok: true;
  readonly dagId: string;
  readonly meta: IDagMdMeta;
  readonly definition: IDagDefinition;
}

export interface IDagMdParseError {
  readonly ok: false;
  readonly error: string;
}

export type TDagMdParseResult = IDagMdParseResult | IDagMdParseError;

// ---------------------------------------------------------------------------
// Frontmatter splitter
// ---------------------------------------------------------------------------

function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('---')) return undefined;

  const afterOpening = trimmed.slice(3);
  // Find the closing ---
  const closingIdx = afterOpening.indexOf('\n---');
  if (closingIdx === -1) return undefined;

  const frontmatter = afterOpening.slice(0, closingIdx).trim();
  const body = afterOpening.slice(closingIdx + 4).trim();
  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Minimal YAML-subset parser
// Supports:
//   key: scalar
//   key: [a, b, c]  (inline arrays of strings)
//   key: { nodeType: x, config: { k: v } }  (inline JSON-ish objects)
//   nested:
//     subkey: value
// ---------------------------------------------------------------------------

type TYamlValue = string | number | boolean | null | TYamlArray | TYamlObject;
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface TYamlArray extends Array<TYamlValue> {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface TYamlObject extends Record<string, TYamlValue> {}

function parseInlineValue(raw: string): TYamlValue {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  const num = Number(s);
  if (!Number.isNaN(num) && s !== '') return num;

  // Inline array [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((item) => parseInlineValue(item.trim()));
  }

  // Inline object { key: val, ... }
  if (s.startsWith('{') && s.endsWith('}')) {
    return parseInlineObject(s.slice(1, -1));
  }

  // Unquoted or quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseInlineObject(inner: string): Record<string, TYamlValue> {
  const result: Record<string, TYamlValue> = {};
  let depth = 0;
  let start = 0;
  const pairs: string[] = [];

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      pairs.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  pairs.push(inner.slice(start).trim());

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;
    const key = pair
      .slice(0, colonIdx)
      .trim()
      .replace(/^["']|["']$/g, '');
    const val = pair.slice(colonIdx + 1).trim();
    if (key) result[key] = parseInlineValue(val);
  }

  return result;
}

function parseYamlLines(lines: string[]): Record<string, TYamlValue> {
  const root: Record<string, TYamlValue> = {};
  const stack: Array<{ indent: number; obj: Record<string, TYamlValue>; key: string | null }> = [
    { indent: -1, obj: root, key: null },
  ];

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trimStart();

    // Pop stack until we find the right parent
    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? -1) >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (!parent) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === '' || rest.startsWith('#')) {
      // Start of a nested object
      const child: Record<string, TYamlValue> = {};
      parent.obj[key] = child;
      stack.push({ indent, obj: child, key });
    } else {
      parent.obj[key] = parseInlineValue(rest);
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// Mermaid flowchart parser
// Extracts A --> B edges from: flowchart LR / flowchart TD syntax
// ---------------------------------------------------------------------------

const MERMAID_BLOCK_RE = /```mermaid\s*([\s\S]*?)```/i;
const ARROW_SPLIT_RE = /\s*--[->]+\s*/;
const NODE_ID_RE = /^(\w+)/;

function parseMermaidEdges(body: string): Array<{ from: string; to: string }> {
  const mermaidMatch = MERMAID_BLOCK_RE.exec(body);
  if (!mermaidMatch) return [];

  const mermaidContent = mermaidMatch[1] ?? '';
  const edges: Array<{ from: string; to: string }> = [];

  for (const line of mermaidContent.split('\n')) {
    const segments = line.split(ARROW_SPLIT_RE);
    if (segments.length < 2) continue;

    const nodeIds: string[] = [];
    for (const seg of segments) {
      const m = NODE_ID_RE.exec(seg.trim());
      if (m?.[1]) nodeIds.push(m[1]);
    }

    for (let i = 0; i < nodeIds.length - 1; i++) {
      const from = nodeIds[i];
      const to = nodeIds[i + 1];
      if (from && to) edges.push({ from, to });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Build IDagDefinition from parsed components
// ---------------------------------------------------------------------------

function toNodeConfigObject(val: TYamlValue): INodeConfigObject {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return {};
  return val as unknown as INodeConfigObject;
}

function resolveNodeSpec(raw: TYamlValue): IDagMdNodeSpec | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, TYamlValue>;
  // Support both 'nodeType' and 'type' aliases
  const nodeType = (obj['nodeType'] ?? obj['type']) as string | undefined;
  if (typeof nodeType !== 'string' || nodeType.trim() === '') return undefined;

  const config = obj['config'];
  return {
    nodeType: nodeType.trim(),
    config:
      config !== undefined &&
      typeof config === 'object' &&
      config !== null &&
      !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : undefined,
    fromPort: typeof obj['fromPort'] === 'string' ? obj['fromPort'] : undefined,
    toPort: typeof obj['toPort'] === 'string' ? obj['toPort'] : undefined,
  };
}

export function parseDagMd(text: string): TDagMdParseResult {
  const split = splitFrontmatter(text);
  if (!split) {
    return { ok: false, error: 'No YAML frontmatter found. File must start with ---.' };
  }

  const { frontmatter, body } = split;
  const yamlLines = frontmatter.split('\n');
  const parsed = parseYamlLines(yamlLines);

  // Extract dagId
  const dagId =
    typeof parsed['dagId'] === 'string' && parsed['dagId'].trim()
      ? parsed['dagId'].trim()
      : undefined;

  if (!dagId) {
    return { ok: false, error: 'frontmatter must include a non-empty "dagId" field.' };
  }

  // Extract meta
  const metaRaw = parsed['meta'];
  const meta: IDagMdMeta =
    typeof metaRaw === 'object' && metaRaw !== null && !Array.isArray(metaRaw)
      ? {
          description:
            typeof (metaRaw as Record<string, TYamlValue>)['description'] === 'string'
              ? String((metaRaw as Record<string, TYamlValue>)['description'])
              : undefined,
          displayName:
            typeof (metaRaw as Record<string, TYamlValue>)['displayName'] === 'string'
              ? String((metaRaw as Record<string, TYamlValue>)['displayName'])
              : undefined,
          tags: Array.isArray((metaRaw as Record<string, TYamlValue>)['tags'])
            ? ((metaRaw as Record<string, TYamlValue>)['tags'] as TYamlValue[]).filter(
                (t): t is string => typeof t === 'string',
              )
            : undefined,
        }
      : {};

  // Extract dag.nodes
  const dagSection = parsed['dag'];
  if (typeof dagSection !== 'object' || dagSection === null || Array.isArray(dagSection)) {
    return { ok: false, error: 'frontmatter must include a "dag.nodes" section.' };
  }

  const nodesSection = (dagSection as Record<string, TYamlValue>)['nodes'];
  if (typeof nodesSection !== 'object' || nodesSection === null || Array.isArray(nodesSection)) {
    return { ok: false, error: 'frontmatter "dag.nodes" must be an object mapping nodeId → spec.' };
  }

  const nodesMap = nodesSection as Record<string, TYamlValue>;
  const nodeSpecs = new Map<string, IDagMdNodeSpec>();

  for (const [nodeId, rawSpec] of Object.entries(nodesMap)) {
    const spec = resolveNodeSpec(rawSpec);
    if (!spec) {
      return {
        ok: false,
        error: `Node "${nodeId}" spec must have a "nodeType" (or "type") field.`,
      };
    }
    nodeSpecs.set(nodeId, spec);
  }

  if (nodeSpecs.size === 0) {
    return { ok: false, error: 'dag.nodes must define at least one node.' };
  }

  // Extract topology from Mermaid
  const mermaidEdges = parseMermaidEdges(body);

  // Compute dependsOn from mermaid edges
  const dependsOnMap = new Map<string, Set<string>>();
  for (const nodeId of nodeSpecs.keys()) {
    dependsOnMap.set(nodeId, new Set());
  }
  for (const edge of mermaidEdges) {
    if (!dependsOnMap.has(edge.to)) dependsOnMap.set(edge.to, new Set());
    dependsOnMap.get(edge.to)?.add(edge.from);
    // Ensure source node is tracked even if not in frontmatter (auto-add as error)
    if (!nodeSpecs.has(edge.from)) {
      return {
        ok: false,
        error: `Mermaid references node "${edge.from}" not defined in dag.nodes.`,
      };
    }
    if (!nodeSpecs.has(edge.to)) {
      return { ok: false, error: `Mermaid references node "${edge.to}" not defined in dag.nodes.` };
    }
  }

  // Build IDagNode[]
  const nodes: IDagNode[] = Array.from(nodeSpecs.entries()).map(([nodeId, spec]) => ({
    nodeId,
    nodeType: spec.nodeType,
    dependsOn: Array.from(dependsOnMap.get(nodeId) ?? []),
    config: toNodeConfigObject(spec.config as TYamlValue),
  }));

  // Build IDagEdgeDefinition[]
  const edges: IDagEdgeDefinition[] = mermaidEdges.map((e) => {
    const fromSpec = nodeSpecs.get(e.from);
    const toSpec = nodeSpecs.get(e.to);
    return {
      from: e.from,
      to: e.to,
      bindings: [
        {
          outputKey: fromSpec?.fromPort ?? 'text',
          inputKey: toSpec?.toPort ?? 'text',
        },
      ],
    };
  });

  const definition: IDagDefinition = {
    dagId,
    version: 1,
    status: 'draft',
    nodes,
    edges,
  };

  return { ok: true, dagId, meta, definition };
}

export const DAG_MD_SUFFIX = '.dag.md';
