/**
 * The workflow-authoring spec: the structured, validated shape the active LLM provider must emit in
 * response to a natural-language description. The runtime assembles a real `IDagDefinition` from this
 * spec deterministically — the LLM authors, it never executes.
 *
 * FLOW-007 Phase 2 (existing nodes) + Phase 3 (`newNodes` prompt-backed nodes).
 */

/** One stage of the linear pipeline — references a node type (built-in or an authored `newNodes` entry). */
export interface IAuthoredStep {
  readonly nodeType: string;
  readonly config?: Record<string, unknown>;
}

/** A prompt-backed node the LLM defines on the fly when no existing node fits (Phase 3). */
export interface IAuthoredPromptNode {
  readonly nodeType: string;
  readonly displayName?: string;
  readonly systemPromptTemplate: string;
  readonly inputPorts: ReadonlyArray<{ readonly key: string; readonly description?: string }>;
  readonly outputPort: { readonly key: string; readonly description?: string };
  readonly provider?: string;
  readonly model?: string;
}

export interface IAuthoredWorkflowSpec {
  readonly name: string;
  readonly description?: string;
  readonly pipeline: readonly IAuthoredStep[];
  readonly newNodes?: readonly IAuthoredPromptNode[];
  /** Optional sample input for the immediate run when the caller does not pass `--input`. */
  readonly sampleInput?: Record<string, string>;
}

export type TParseSpecResult =
  | { readonly ok: true; readonly spec: IAuthoredWorkflowSpec }
  | { readonly ok: false; readonly error: string };

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePorts(value: unknown): ReadonlyArray<{ key: string; description?: string }> | null {
  if (!Array.isArray(value)) return null;
  const ports: Array<{ key: string; description?: string }> = [];
  for (const raw of value) {
    const r = asRecord(raw);
    if (!r || typeof r['key'] !== 'string') return null;
    ports.push(
      typeof r['description'] === 'string'
        ? { key: r['key'], description: r['description'] }
        : { key: r['key'] },
    );
  }
  return ports;
}

function parsePromptNode(raw: unknown): IAuthoredPromptNode | { error: string } {
  const r = asRecord(raw);
  if (!r) return { error: 'newNodes entry is not an object' };
  if (typeof r['nodeType'] !== 'string' || !NAME_PATTERN.test(r['nodeType'])) {
    return { error: `newNodes entry has an invalid nodeType: ${JSON.stringify(r['nodeType'])}` };
  }
  if (typeof r['systemPromptTemplate'] !== 'string' || r['systemPromptTemplate'].trim() === '') {
    return { error: `newNodes "${r['nodeType']}" is missing systemPromptTemplate` };
  }
  const inputPorts = parsePorts(r['inputPorts']);
  if (!inputPorts || inputPorts.length === 0) {
    return { error: `newNodes "${r['nodeType']}" has no valid inputPorts` };
  }
  const outputRec = asRecord(r['outputPort']);
  if (!outputRec || typeof outputRec['key'] !== 'string') {
    return { error: `newNodes "${r['nodeType']}" has no valid outputPort` };
  }
  return {
    nodeType: r['nodeType'],
    ...(typeof r['displayName'] === 'string' ? { displayName: r['displayName'] } : {}),
    systemPromptTemplate: r['systemPromptTemplate'],
    inputPorts,
    outputPort:
      typeof outputRec['description'] === 'string'
        ? { key: outputRec['key'], description: outputRec['description'] }
        : { key: outputRec['key'] },
    ...(typeof r['provider'] === 'string' ? { provider: r['provider'] } : {}),
    ...(typeof r['model'] === 'string' ? { model: r['model'] } : {}),
  };
}

function parseSampleInput(value: unknown): Record<string, string> | undefined {
  const r = asRecord(value);
  if (!r) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse + validate a raw JSON string (the provider's response) into an `IAuthoredWorkflowSpec`.
 * Returns a structured error (never throws) so the caller can surface it and write nothing.
 */
/**
 * Strip a Markdown code fence (```` ```json … ``` ````) the LLM may wrap its JSON in despite being
 * asked not to — a common provider behavior even under a JSON response format.
 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z0-9]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

export function parseAuthoredSpec(raw: string): TParseSpecResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `provider did not return valid JSON: ${detail}` };
  }

  const r = asRecord(parsed);
  if (!r) return { ok: false, error: 'authoring spec is not a JSON object' };

  if (typeof r['name'] !== 'string' || !NAME_PATTERN.test(r['name'])) {
    return {
      ok: false,
      error: `authoring spec "name" must match ${NAME_PATTERN.source}; got ${JSON.stringify(r['name'])}`,
    };
  }
  const name = r['name'];

  if (!Array.isArray(r['pipeline']) || r['pipeline'].length === 0) {
    return { ok: false, error: 'authoring spec "pipeline" must be a non-empty array' };
  }
  const pipeline: IAuthoredStep[] = [];
  for (const rawStep of r['pipeline']) {
    const step = asRecord(rawStep);
    if (!step || typeof step['nodeType'] !== 'string') {
      return { ok: false, error: 'each pipeline stage must be an object with a string nodeType' };
    }
    const cfg = asRecord(step['config']);
    pipeline.push(
      cfg ? { nodeType: step['nodeType'], config: cfg } : { nodeType: step['nodeType'] },
    );
  }

  let newNodes: IAuthoredPromptNode[] | undefined;
  if (r['newNodes'] !== undefined) {
    if (!Array.isArray(r['newNodes'])) {
      return { ok: false, error: 'authoring spec "newNodes" must be an array when present' };
    }
    newNodes = [];
    for (const rawNode of r['newNodes']) {
      const node = parsePromptNode(rawNode);
      if ('error' in node) return { ok: false, error: node.error };
      newNodes.push(node);
    }
  }

  const sampleInput = parseSampleInput(r['sampleInput']);

  return {
    ok: true,
    spec: {
      name,
      ...(typeof r['description'] === 'string' ? { description: r['description'] } : {}),
      pipeline,
      ...(newNodes && newNodes.length > 0 ? { newNodes } : {}),
      ...(sampleInput ? { sampleInput } : {}),
    },
  };
}
