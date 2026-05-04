// packages/dag-designer/src/components/__tests__/comfyui-field-renderers.test.ts
import { describe, it, expect } from 'vitest';
import { parseInputSpec, parseAllInputs } from '../comfyui-field-renderers.js';

describe('parseInputSpec', () => {
  it('parses INT with metadata as parameter', () => {
    const result = parseInputSpec('seed', ['INT', { default: 0, min: 0, max: 100 }], true);
    expect(result.typeName).toBe('INT');
    expect(result.isParameter).toBe(true);
    expect(result.isRequired).toBe(true);
    expect(result.metadata).toEqual({ default: 0, min: 0, max: 100 });
  });

  it('parses STRING as parameter', () => {
    const result = parseInputSpec('prompt', ['STRING'], true);
    expect(result.typeName).toBe('STRING');
    expect(result.isParameter).toBe(true);
  });

  it('parses MODEL as handle', () => {
    const result = parseInputSpec('model', ['MODEL'], true);
    expect(result.typeName).toBe('MODEL');
    expect(result.isParameter).toBe(false);
  });

  it('parses IMAGE as handle', () => {
    const result = parseInputSpec('image', ['IMAGE'], true);
    expect(result.isParameter).toBe(false);
  });

  it('parses string[] as enum parameter', () => {
    const result = parseInputSpec('sampler', ['euler', 'euler_a', 'dpmpp_2m'], true);
    expect(result.typeName).toBe('ENUM');
    expect(result.isParameter).toBe(true);
    expect(result.enumOptions).toEqual(['euler', 'euler_a', 'dpmpp_2m']);
  });

  it('parses two-value string[] as enum parameter', () => {
    const result = parseInputSpec('scheduler', ['normal', 'karras'], true);
    expect(result.typeName).toBe('ENUM');
    expect(result.isParameter).toBe(true);
    expect(result.enumOptions).toEqual(['normal', 'karras']);
  });

  it('parses upload enum tuples as file upload parameters', () => {
    const spec = [['upload'], { image_upload: true }] as unknown as Parameters<
      typeof parseInputSpec
    >[1];
    const result = parseInputSpec('image', spec, true);
    expect(result.typeName).toBe('ENUM');
    expect(result.isParameter).toBe(true);
    expect(result.imageUpload).toBe(true);
    expect(result.enumOptions).toEqual(['upload']);
  });

  it('parses BOOLEAN as parameter', () => {
    const result = parseInputSpec('enabled', ['BOOLEAN'], false);
    expect(result.typeName).toBe('BOOLEAN');
    expect(result.isParameter).toBe(true);
    expect(result.isRequired).toBe(false);
  });

  it('parses FLOAT with metadata', () => {
    const result = parseInputSpec(
      'cfg',
      ['FLOAT', { default: 7.0, min: 0, max: 30, step: 0.5 }],
      true,
    );
    expect(result.typeName).toBe('FLOAT');
    expect(result.isParameter).toBe(true);
    expect(result.metadata.step).toBe(0.5);
  });
});

describe('parseAllInputs', () => {
  it('parses required and optional inputs', () => {
    const fields = parseAllInputs({
      required: {
        model: ['MODEL'],
        seed: ['INT', { default: 0 }],
      },
      optional: {
        prompt: ['STRING'],
      },
    });
    expect(fields).toHaveLength(3);
    expect(fields.filter((f) => f.isParameter)).toHaveLength(2); // seed, prompt
    expect(fields.filter((f) => !f.isParameter)).toHaveLength(1); // model
    expect(fields.find((f) => f.key === 'prompt')?.isRequired).toBe(false);
  });
});
