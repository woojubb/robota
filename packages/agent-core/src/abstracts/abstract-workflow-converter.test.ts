import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AbstractWorkflowConverter } from './abstract-workflow-converter';
import type { IWorkflowData, IWorkflowConversionOptions } from '../interfaces/workflow-converter';

interface ITestInput extends IWorkflowData {
  nodes: Array<{ id: string }>;
}

interface ITestOutput extends IWorkflowData {
  items: Array<{ id: string }>;
}

class TestConverter extends AbstractWorkflowConverter<ITestInput, ITestOutput> {
  readonly name = 'test-converter';
  readonly version = '1.0.0';
  readonly sourceFormat = 'test-input';
  readonly targetFormat = 'test-output';

  shouldFail = false;

  protected async performConversion(input: ITestInput): Promise<ITestOutput> {
    if (this.shouldFail) throw new Error('conversion failed');
    return { items: input.nodes.map((n) => ({ id: n.id })) };
  }
}

class FailInputConverter extends AbstractWorkflowConverter<ITestInput, ITestOutput> {
  readonly name = 'fail-input-converter';
  readonly version = '1.0.0';
  readonly sourceFormat = 'test-input';
  readonly targetFormat = 'test-output';

  protected async performConversion(input: ITestInput): Promise<ITestOutput> {
    return { items: [] };
  }

  override async validateInput(input: ITestInput) {
    return { isValid: false, errors: ['bad input'], warnings: ['input warning'] };
  }
}

class FailOutputConverter extends AbstractWorkflowConverter<ITestInput, ITestOutput> {
  readonly name = 'fail-output-converter';
  readonly version = '1.0.0';
  readonly sourceFormat = 'test-input';
  readonly targetFormat = 'test-output';

  protected async performConversion(input: ITestInput): Promise<ITestOutput> {
    return { items: [] };
  }

  override async validateOutput(output: ITestOutput) {
    return { isValid: false, errors: ['bad output'], warnings: [] };
  }
}

describe('AbstractWorkflowConverter', () => {
  let converter: TestConverter;

  beforeEach(() => {
    converter = new TestConverter();
  });

  describe('convert', () => {
    it('converts input to output successfully', async () => {
      const result = await converter.convert({ nodes: [{ id: 'n1' }, { id: 'n2' }] });
      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(2);
      expect(result.errors).toEqual([]);
    });

    it('throws when converter is disabled', async () => {
      converter.enabled = false;
      await expect(converter.convert({ nodes: [] })).rejects.toThrow('is disabled');
    });

    it('validates input when requested', async () => {
      const failConverter = new FailInputConverter();
      const result = await failConverter.convert({ nodes: [] }, { validateInput: true });
      expect(result.success).toBe(false);
      expect(result.errors).toContain('bad input');
    });

    it('validates output when requested', async () => {
      const failConverter = new FailOutputConverter();
      const result = await failConverter.convert({ nodes: [] }, { validateOutput: true });
      expect(result.success).toBe(false);
      expect(result.errors).toContain('bad output');
    });

    it('handles conversion error gracefully', async () => {
      converter.shouldFail = true;
      const result = await converter.convert({ nodes: [] });
      expect(result.success).toBe(false);
      expect(result.errors).toContain('conversion failed');
    });

    it('updates stats on success', async () => {
      await converter.convert({ nodes: [] });
      const stats = converter.getStats();
      expect(stats.totalConversions).toBe(1);
      expect(stats.successfulConversions).toBe(1);
    });

    it('updates stats on failure', async () => {
      converter.shouldFail = true;
      await converter.convert({ nodes: [] });
      const stats = converter.getStats();
      expect(stats.totalConversions).toBe(1);
      expect(stats.failedConversions).toBe(1);
    });

    it('includes debug info when requested', async () => {
      const result = await converter.convert({ nodes: [] }, { includeDebug: true });
      expect(result.metadata).toBeDefined();
    });
  });

  describe('validateInput', () => {
    it('returns valid for normal input', async () => {
      const result = await converter.validateInput({ nodes: [] });
      expect(result.isValid).toBe(true);
    });

    it('returns invalid for null input', async () => {
      const result = await converter.validateInput(null as any);
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateOutput', () => {
    it('returns valid for normal output', async () => {
      const result = await converter.validateOutput({ items: [] });
      expect(result.isValid).toBe(true);
    });

    it('returns invalid for null output', async () => {
      const result = await converter.validateOutput(null as any);
      expect(result.isValid).toBe(false);
    });
  });

  describe('canConvert', () => {
    it('returns true for valid data', () => {
      expect(converter.canConvert({ nodes: [] })).toBe(true);
    });

    it('returns false for null', () => {
      expect(converter.canConvert(null as any)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns zeroed stats initially', () => {
      const stats = converter.getStats();
      expect(stats.totalConversions).toBe(0);
      expect(stats.averageProcessingTime).toBe(0);
    });
  });

  describe('resetStats', () => {
    it('resets stats to zero', async () => {
      await converter.convert({ nodes: [] });
      converter.resetStats();
      expect(converter.getStats().totalConversions).toBe(0);
    });
  });

  describe('getDataStats', () => {
    it('extracts node and edge counts', async () => {
      const result = await converter.convert({
        nodes: [{ id: '1' }, { id: '2' }],
        edges: [{ from: '1', to: '2' }],
      } as any);
      expect(result.metadata.inputStats.nodeCount).toBe(2);
      expect(result.metadata.inputStats.edgeCount).toBe(1);
    });
  });
});
