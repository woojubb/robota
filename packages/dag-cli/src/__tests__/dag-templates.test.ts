import { describe, it, expect } from 'vitest';
import { TEMPLATE_REGISTRY, buildPipelineFromTemplate } from '../templates/dag-templates.js';

describe('TEMPLATE_REGISTRY', () => {
  it('exports known template ids', () => {
    const ids = TEMPLATE_REGISTRY.map((t) => t.id);
    expect(ids).toContain('linear');
    expect(ids).toContain('chain');
    expect(ids).toContain('parallel-review');
  });

  it('each template has required fields', () => {
    for (const tmpl of TEMPLATE_REGISTRY) {
      expect(typeof tmpl.id).toBe('string');
      expect(typeof tmpl.description).toBe('string');
      expect(typeof tmpl.topology).toBe('string');
      expect(Array.isArray(tmpl.slots)).toBe(true);
    }
  });
});

describe('buildPipelineFromTemplate: linear', () => {
  it('builds linear pipeline with llm slot', () => {
    const result = buildPipelineFromTemplate('linear', {
      llm: { nodeType: 'llm-text', config: { systemPrompt: 'Be concise' } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pipeline } = result.buildInput;
    expect(pipeline).toHaveLength(3);
    expect((pipeline[0] as { nodeType: string }).nodeType).toBe('input');
    expect((pipeline[1] as { nodeType: string }).nodeType).toBe('llm-text');
    expect((pipeline[2] as { nodeType: string }).nodeType).toBe('text-output');
  });

  it('uses provided dagId', () => {
    const result = buildPipelineFromTemplate('linear', { llm: { nodeType: 'llm-text' } }, 'my-dag');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.buildInput.dagId).toBe('my-dag');
  });

  it('errors when llm slot missing', () => {
    const result = buildPipelineFromTemplate('linear', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/slots\.llm/);
  });

  it('errors when llm.nodeType missing', () => {
    const result = buildPipelineFromTemplate('linear', { llm: { config: {} } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/nodeType/);
  });
});

describe('buildPipelineFromTemplate: chain', () => {
  it('builds chain with multiple steps', () => {
    const result = buildPipelineFromTemplate('chain', {
      steps: [
        { nodeType: 'llm-text', config: { systemPrompt: 'Translate to Korean' } },
        { nodeType: 'llm-text', config: { systemPrompt: 'Summarise' } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pipeline } = result.buildInput;
    expect(pipeline).toHaveLength(4); // input + 2 steps + output
    expect((pipeline[0] as { nodeType: string }).nodeType).toBe('input');
    expect((pipeline[3] as { nodeType: string }).nodeType).toBe('text-output');
  });

  it('errors when steps is empty', () => {
    const result = buildPipelineFromTemplate('chain', { steps: [] });
    expect(result.ok).toBe(false);
  });

  it('errors when steps is not an array', () => {
    const result = buildPipelineFromTemplate('chain', { steps: 'not-an-array' });
    expect(result.ok).toBe(false);
  });
});

describe('buildPipelineFromTemplate: parallel-review', () => {
  it('builds fan-out pipeline', () => {
    const result = buildPipelineFromTemplate('parallel-review', {
      branches: [
        { nodeType: 'llm-text', id: 'security', config: { systemPrompt: 'Security' } },
        { nodeType: 'llm-text', id: 'perf', config: { systemPrompt: 'Performance' } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pipeline } = result.buildInput;
    expect(pipeline).toHaveLength(2); // input + parallel stage
    const parallelStage = pipeline[1] as { parallel: unknown[] };
    expect(Array.isArray(parallelStage.parallel)).toBe(true);
    expect(parallelStage.parallel).toHaveLength(2);
  });

  it('errors when branches is empty', () => {
    const result = buildPipelineFromTemplate('parallel-review', { branches: [] });
    expect(result.ok).toBe(false);
  });
});

describe('buildPipelineFromTemplate: unknown template', () => {
  it('returns error for unknown id', () => {
    const result = buildPipelineFromTemplate('does-not-exist', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/does-not-exist/);
  });
});
