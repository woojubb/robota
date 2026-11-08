import { describe, it, expect } from 'vitest';

import { askUserQuestionTool } from '../builtins/ask-user-question-tool';
import { createComputerTool } from '../computer-use/computer-tool';

/**
 * CORE-039 — the schemas two SHIPPED built-in tools actually advertise.
 *
 * Both were broken in the field: `Computer`'s act tool reached the model as
 * `action: { type: 'object' }` with all eleven action fields absent, and `AskUserQuestion` as
 * `questions.items: { type: 'object' }` with every question field absent. The model was told a
 * field existed and nothing about what belonged in it.
 *
 * Importing this module is itself part of the test: `askUserQuestionTool` is constructed at module
 * level, so a converter that throws on the nested union in `QuestionSchema.options` takes the whole
 * `@robota-sdk/agent-tools` entry point down on load and no assertion below is ever reached.
 */
describe('Computer act tool — advertised parameter schema', () => {
  const actParameters = createComputerTool()[1]!.schema.parameters;
  const action = actParameters.properties['action'];

  it('names the action vocabulary instead of emitting a bare object', () => {
    expect(action?.type).toBe('object');
    expect(action?.properties?.['type']?.enum).toEqual([
      'click',
      'double_click',
      'type',
      'keypress',
      'scroll',
      'drag',
      'wait',
      'takeover',
    ]);
  });

  it('declares the action fields the driver needs', () => {
    expect(Object.keys(action?.properties ?? {})).toEqual([
      'type',
      'x',
      'y',
      'button',
      'text',
      'keys',
      'deltaX',
      'deltaY',
      'path',
      'ms',
      'reason',
    ]);
  });

  it('requires only the discriminator, since every other field is per-action', () => {
    expect(action?.required).toEqual(['type']);
  });

  it('keeps the point shape three levels down, inside the drag path array', () => {
    const point = action?.properties?.['path']?.items;
    expect(point?.properties?.['x']?.type).toBe('number');
    expect(point?.properties?.['y']?.type).toBe('number');
    expect(point?.required).toEqual(['x', 'y']);
  });
});

describe('AskUserQuestion tool — advertised parameter schema', () => {
  const parameters = askUserQuestionTool.schema.parameters;
  const question = parameters.properties['questions']?.items;

  it('names the question fields instead of emitting a bare object', () => {
    expect(question?.type).toBe('object');
    expect(Object.keys(question?.properties ?? {})).toEqual([
      'question',
      'header',
      'options',
      'multiSelect',
      'allowFreeText',
    ]);
    expect(question?.required).toEqual(['question']);
  });

  it('expresses the mixed string-or-object option shape as a union', () => {
    const option = question?.properties?.['options']?.items;
    expect(option?.anyOf).toHaveLength(2);
    expect(option?.anyOf?.[0]?.type).toBe('string');
    expect(option?.anyOf?.[1]?.properties?.['label']?.type).toBe('string');
  });
});
