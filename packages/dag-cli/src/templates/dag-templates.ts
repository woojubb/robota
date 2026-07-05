import type { IDagBuildInput, IPipelineNodeSpec } from '@robota-sdk/dag-builder';

export interface ITemplateSlotSpec {
  readonly name: string;
  readonly description: string;
  readonly type: 'node' | 'node-array';
  readonly required: boolean;
  readonly example?: unknown;
}

export interface ITemplateInfo {
  readonly id: string;
  readonly description: string;
  readonly topology: string;
  readonly slots: readonly ITemplateSlotSpec[];
  readonly example: Record<string, unknown>;
}

export type TTemplateSlots = Record<string, unknown>;

export type TTemplateBuildResult =
  | { readonly ok: true; readonly buildInput: IDagBuildInput }
  | { readonly ok: false; readonly error: string };

export const TEMPLATE_REGISTRY: readonly ITemplateInfo[] = [
  {
    id: 'linear',
    description: 'Single LLM pipeline: input → LLM → output',
    topology: 'input → llm → text-output',
    slots: [
      {
        name: 'llm',
        description: 'LLM node spec. Must be a valid node type with text input/output.',
        type: 'node',
        required: true,
        example: { nodeType: 'llm-text-anthropic', config: { systemPrompt: 'Answer concisely' } },
      },
    ],
    example: {
      slots: {
        llm: { nodeType: 'llm-text-anthropic', config: { systemPrompt: 'Answer concisely' } },
      },
    },
  },
  {
    id: 'chain',
    description: 'Sequential transformation pipeline: input → step1 → step2 → … → output',
    topology: 'input → steps[0] → steps[1] → … → text-output',
    slots: [
      {
        name: 'steps',
        description: 'Ordered array of node specs. Each step passes text to the next.',
        type: 'node-array',
        required: true,
        example: [
          { nodeType: 'llm-text-anthropic', config: { systemPrompt: 'Translate to Korean' } },
          { nodeType: 'llm-text-anthropic', config: { systemPrompt: 'Summarise in one sentence' } },
        ],
      },
    ],
    example: {
      slots: {
        steps: [
          { nodeType: 'llm-text-anthropic', config: { systemPrompt: 'Translate to Korean' } },
          { nodeType: 'llm-text-anthropic', config: { systemPrompt: 'Summarise in one sentence' } },
        ],
      },
    },
  },
  {
    id: 'parallel-review',
    description:
      'Fan-out review: input → [reviewer1, reviewer2, …]. Each reviewer sees the same input independently. Use dag_build with a parallel stage for full control.',
    topology: 'input → [branches[0], branches[1], …]',
    slots: [
      {
        name: 'branches',
        description: 'Array of parallel reviewer node specs. Each receives the same input text.',
        type: 'node-array',
        required: true,
        example: [
          {
            nodeType: 'llm-text-anthropic',
            id: 'security',
            config: { systemPrompt: 'Security review' },
          },
          {
            nodeType: 'llm-text-anthropic',
            id: 'perf',
            config: { systemPrompt: 'Performance review' },
          },
        ],
      },
    ],
    example: {
      slots: {
        branches: [
          {
            nodeType: 'llm-text-anthropic',
            id: 'security',
            config: { systemPrompt: 'Security review' },
          },
          {
            nodeType: 'llm-text-anthropic',
            id: 'quality',
            config: { systemPrompt: 'Quality review' },
          },
        ],
      },
    },
  },
];

function parseNodeSpec(raw: unknown, fieldName: string): IPipelineNodeSpec | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `"${fieldName}" must be a node spec object with a "nodeType" field`;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj['nodeType'] !== 'string' || obj['nodeType'].trim().length === 0) {
    return `"${fieldName}.nodeType" must be a non-empty string`;
  }
  return {
    nodeType: obj['nodeType'],
    id: typeof obj['id'] === 'string' ? obj['id'] : undefined,
    config:
      typeof obj['config'] === 'object' && obj['config'] !== null && !Array.isArray(obj['config'])
        ? (obj['config'] as Record<string, unknown>)
        : undefined,
    fromPort: typeof obj['fromPort'] === 'string' ? obj['fromPort'] : undefined,
    toPort: typeof obj['toPort'] === 'string' ? obj['toPort'] : undefined,
  };
}

function parseNodeSpecArray(raw: unknown, fieldName: string): IPipelineNodeSpec[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return `"${fieldName}" must be a non-empty array of node spec objects`;
  }
  const result: IPipelineNodeSpec[] = [];
  for (let i = 0; i < raw.length; i++) {
    const spec = parseNodeSpec(raw[i], `${fieldName}[${i}]`);
    if (typeof spec === 'string') return spec;
    result.push(spec);
  }
  return result;
}

export function buildPipelineFromTemplate(
  templateId: string,
  slots: TTemplateSlots,
  dagId?: string,
): TTemplateBuildResult {
  switch (templateId) {
    case 'linear': {
      const llmSpec = parseNodeSpec(slots['llm'], 'slots.llm');
      if (typeof llmSpec === 'string') return { ok: false, error: llmSpec };
      return {
        ok: true,
        buildInput: {
          dagId: dagId ?? `linear-${Date.now()}`,
          pipeline: [
            { nodeType: 'input', id: 'input' },
            llmSpec,
            { nodeType: 'text-output', id: 'output' },
          ],
        },
      };
    }

    case 'chain': {
      const steps = parseNodeSpecArray(slots['steps'], 'slots.steps');
      if (typeof steps === 'string') return { ok: false, error: steps };
      return {
        ok: true,
        buildInput: {
          dagId: dagId ?? `chain-${Date.now()}`,
          pipeline: [
            { nodeType: 'input', id: 'input' },
            ...steps,
            { nodeType: 'text-output', id: 'output' },
          ],
        },
      };
    }

    case 'parallel-review': {
      const branches = parseNodeSpecArray(slots['branches'], 'slots.branches');
      if (typeof branches === 'string') return { ok: false, error: branches };
      return {
        ok: true,
        buildInput: {
          dagId: dagId ?? `parallel-review-${Date.now()}`,
          pipeline: [{ nodeType: 'input', id: 'input' }, { parallel: branches }],
        },
      };
    }

    default:
      return {
        ok: false,
        error: `Unknown template "${templateId}". Available: ${TEMPLATE_REGISTRY.map((t) => t.id).join(', ')}`,
      };
  }
}
