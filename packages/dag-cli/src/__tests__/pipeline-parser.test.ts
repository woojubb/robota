import { describe, expect, it } from 'vitest';
import { parsePipelineSpec } from '../pipeline-parser.js';

describe('parsePipelineSpec', () => {
  describe('basic parsing', () => {
    it('parses a simple 3-node pipeline without config', () => {
      const result = parsePipelineSpec('input | transform | text-output');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes[0]).toEqual({ nodeType: 'input', config: {} });
      expect(result.nodes[1]).toEqual({ nodeType: 'transform', config: {} });
      expect(result.nodes[2]).toEqual({ nodeType: 'text-output', config: {} });
    });

    it('returns error for empty pipeline', () => {
      const result = parsePipelineSpec('');
      expect(result.ok).toBe(false);
    });

    it('parses a single-node pipeline', () => {
      const result = parsePipelineSpec('input');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('inline config syntax', () => {
    it('parses a node with a single string config', () => {
      const result = parsePipelineSpec('input | transform[prefix=→] | text-output');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes[1]?.config).toEqual({ prefix: '→' });
    });

    it('parses a node with multiple config entries', () => {
      const result = parsePipelineSpec('input | transform[prefix=→ ,suffix= ←] | text-output');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes[1]?.config).toEqual({ prefix: '→ ', suffix: ' ←' });
    });

    it('infers number type for numeric values', () => {
      const result = parsePipelineSpec('input | transform[count=3] | text-output');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes[1]?.config['count']).toBe(3);
    });

    it('infers boolean true', () => {
      const result = parsePipelineSpec('input | transform[enabled=true] | text-output');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes[1]?.config['enabled']).toBe(true);
    });

    it('infers boolean false', () => {
      const result = parsePipelineSpec('input | transform[enabled=false] | text-output');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes[1]?.config['enabled']).toBe(false);
    });

    it('parses quoted value containing a comma', () => {
      const result = parsePipelineSpec(
        'input | transform[systemPrompt="Hello, world"] | text-output',
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes[1]?.config['systemPrompt']).toBe('Hello, world');
    });

    it('parses multiple config pairs with model and systemPrompt', () => {
      const result = parsePipelineSpec(
        'input | llm-text[model=claude-haiku-4-5-20251001,systemPrompt=Answer briefly] | text-output',
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nodes[1]?.config).toEqual({
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'Answer briefly',
      });
    });

    it('returns error for unclosed bracket', () => {
      const result = parsePipelineSpec('input | transform[prefix=→ | text-output');
      expect(result.ok).toBe(false);
    });

    it('returns error for unclosed quote in config', () => {
      const result = parsePipelineSpec('input | transform[key="unclosed] | text-output');
      expect(result.ok).toBe(false);
    });
  });
});
