import { describe, expect, it } from 'vitest';
import type { INodeConfigObject, INodeExecutionContext } from '@robota-sdk/dag-core';
import {
  StringToNumberNodeDefinition,
  NumberToStringNodeDefinition,
  TextJoinNodeDefinition,
  TextSplitNodeDefinition,
  TextReplaceNodeDefinition,
  TextLengthNodeDefinition,
  TextUpperNodeDefinition,
  TextLowerNodeDefinition,
  TextTrimNodeDefinition,
  JsonExtractNodeDefinition,
  ConditionalTextNodeDefinition,
  TextCountLinesNodeDefinition,
  TextRepeatNodeDefinition,
  TextSliceNodeDefinition,
} from '../index.js';

function ctx(nodeType: string, config: INodeConfigObject = {}): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'node-1',
      nodeType,
      dependsOn: [],
      inputs: [],
      outputs: [],
      config,
    },
    nodeManifest: {
      nodeType,
      displayName: nodeType,
      category: 'Utility',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

// ─── string-to-number ────────────────────────────────────────────────────────

describe('StringToNumberNodeDefinition', () => {
  const node = new StringToNumberNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('string-to-number');
    expect(node.category).toBe('Utility');
  });

  it('converts integer string', async () => {
    const r = await node.taskHandler.execute({ text: '42' }, ctx('string-to-number'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.number).toBe('42');
  });

  it('converts float string', async () => {
    const r = await node.taskHandler.execute({ text: '3.14' }, ctx('string-to-number'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.number).toBe('3.14');
  });

  it('returns error for non-numeric string', async () => {
    const r = await node.taskHandler.execute({ text: 'hello' }, ctx('string-to-number'));
    expect(r.ok).toBe(false);
  });

  it('returns error when text input missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('string-to-number'));
    expect(r.ok).toBe(false);
  });

  it('estimates cost as zero', async () => {
    const r = await node.taskHandler.estimateCost!({}, ctx('string-to-number'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.estimatedCredits).toBe(0);
  });
});

// ─── number-to-string ────────────────────────────────────────────────────────

describe('NumberToStringNodeDefinition', () => {
  const node = new NumberToStringNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('number-to-string');
    expect(node.category).toBe('Utility');
  });

  it('passes number through as text', async () => {
    const r = await node.taskHandler.execute({ number: '99' }, ctx('number-to-string'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('99');
  });

  it('returns error when number input missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('number-to-string'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-join ───────────────────────────────────────────────────────────────

describe('TextJoinNodeDefinition', () => {
  const node = new TextJoinNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-join');
    expect(node.category).toBe('Utility');
  });

  it('joins newline-separated items with default separator', async () => {
    const r = await node.taskHandler.execute({ items: 'apple\nbanana\ncherry' }, ctx('text-join'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('apple, banana, cherry');
  });

  it('joins with custom separator', async () => {
    const r = await node.taskHandler.execute(
      { items: 'a\nb\nc' },
      ctx('text-join', { separator: ' | ' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('a | b | c');
  });

  it('filters empty lines', async () => {
    const r = await node.taskHandler.execute({ items: 'a\n\nb' }, ctx('text-join'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('a, b');
  });

  it('returns error when items missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-join'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-split ──────────────────────────────────────────────────────────────

describe('TextSplitNodeDefinition', () => {
  const node = new TextSplitNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-split');
    expect(node.category).toBe('Utility');
  });

  it('splits by default newline separator', async () => {
    const r = await node.taskHandler.execute({ text: 'a\nb\nc' }, ctx('text-split'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toBe('a\nb\nc');
  });

  it('splits by custom separator', async () => {
    const r = await node.taskHandler.execute(
      { text: 'a,b,c' },
      ctx('text-split', { separator: ',', trim: false }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toBe('a\nb\nc');
  });

  it('trims whitespace when trim=true', async () => {
    const r = await node.taskHandler.execute(
      { text: ' a , b , c ' },
      ctx('text-split', { separator: ',', trim: true }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toBe('a\nb\nc');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-split'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-replace ─────────────────────────────────────────────────────────────

describe('TextReplaceNodeDefinition', () => {
  const node = new TextReplaceNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-replace');
    expect(node.category).toBe('Utility');
  });

  it('replaces literal text globally', async () => {
    const r = await node.taskHandler.execute(
      { text: 'foo bar foo' },
      ctx('text-replace', { search: 'foo', replacement: 'baz', useRegex: false }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('baz bar baz');
  });

  it('replaces using regex', async () => {
    const r = await node.taskHandler.execute(
      { text: 'Hello World' },
      ctx('text-replace', { search: '[aeiou]', replacement: '*', useRegex: true, flags: 'gi' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('H*ll* W*rld');
  });

  it('returns error for invalid regex', async () => {
    const r = await node.taskHandler.execute(
      { text: 'test' },
      ctx('text-replace', { search: '[invalid', useRegex: true }),
    );
    expect(r.ok).toBe(false);
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-replace'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-length ──────────────────────────────────────────────────────────────

describe('TextLengthNodeDefinition', () => {
  const node = new TextLengthNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-length');
    expect(node.category).toBe('Utility');
  });

  it('returns character count', async () => {
    const r = await node.taskHandler.execute({ text: 'hello' }, ctx('text-length'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('5');
  });

  it('returns 0 for empty string', async () => {
    const r = await node.taskHandler.execute({ text: '' }, ctx('text-length'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('0');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-length'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-upper ───────────────────────────────────────────────────────────────

describe('TextUpperNodeDefinition', () => {
  const node = new TextUpperNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-upper');
    expect(node.category).toBe('Utility');
  });

  it('converts text to uppercase', async () => {
    const r = await node.taskHandler.execute({ text: 'hello world' }, ctx('text-upper'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('HELLO WORLD');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-upper'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-lower ───────────────────────────────────────────────────────────────

describe('TextLowerNodeDefinition', () => {
  const node = new TextLowerNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-lower');
    expect(node.category).toBe('Utility');
  });

  it('converts text to lowercase', async () => {
    const r = await node.taskHandler.execute({ text: 'HELLO WORLD' }, ctx('text-lower'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('hello world');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-lower'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-trim ────────────────────────────────────────────────────────────────

describe('TextTrimNodeDefinition', () => {
  const node = new TextTrimNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-trim');
    expect(node.category).toBe('Utility');
  });

  it('trims both ends by default', async () => {
    const r = await node.taskHandler.execute({ text: '  hello  ' }, ctx('text-trim'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('hello');
  });

  it('trims only start', async () => {
    const r = await node.taskHandler.execute(
      { text: '  hello  ' },
      ctx('text-trim', { mode: 'start' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('hello  ');
  });

  it('trims only end', async () => {
    const r = await node.taskHandler.execute(
      { text: '  hello  ' },
      ctx('text-trim', { mode: 'end' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('  hello');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-trim'));
    expect(r.ok).toBe(false);
  });
});

// ─── json-extract ─────────────────────────────────────────────────────────────

describe('JsonExtractNodeDefinition', () => {
  const node = new JsonExtractNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('json-extract');
    expect(node.category).toBe('Utility');
  });

  it('extracts top-level value', async () => {
    const r = await node.taskHandler.execute(
      { json: '{"name":"Alice"}' },
      ctx('json-extract', { path: 'name' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('Alice');
  });

  it('extracts nested value with dot notation', async () => {
    const r = await node.taskHandler.execute(
      { json: '{"user":{"age":30}}' },
      ctx('json-extract', { path: 'user.age' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('30');
  });

  it('returns fallback when path not found', async () => {
    const r = await node.taskHandler.execute(
      { json: '{}' },
      ctx('json-extract', { path: 'missing', fallback: 'N/A' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('N/A');
  });

  it('returns entire JSON when path is empty', async () => {
    const r = await node.taskHandler.execute(
      { json: '"hello"' },
      ctx('json-extract', { path: '' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('hello');
  });

  it('returns error for invalid JSON', async () => {
    const r = await node.taskHandler.execute(
      { json: 'not json' },
      ctx('json-extract', { path: 'x' }),
    );
    expect(r.ok).toBe(false);
  });

  it('returns error when json input missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('json-extract'));
    expect(r.ok).toBe(false);
  });
});

// ─── conditional-text ─────────────────────────────────────────────────────────

describe('ConditionalTextNodeDefinition', () => {
  const node = new ConditionalTextNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('conditional-text');
    expect(node.category).toBe('Utility');
  });

  it('returns text_true when condition is non-empty', async () => {
    const r = await node.taskHandler.execute(
      { condition: 'yes', text_true: 'A', text_false: 'B' },
      ctx('conditional-text'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('A');
  });

  it('returns text_false when condition is empty', async () => {
    const r = await node.taskHandler.execute(
      { condition: '', text_true: 'A', text_false: 'B' },
      ctx('conditional-text'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('B');
  });

  it('returns empty string when text_false not provided and condition false', async () => {
    const r = await node.taskHandler.execute(
      { condition: '', text_true: 'A' },
      ctx('conditional-text'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('');
  });

  it('equals operator', async () => {
    const r = await node.taskHandler.execute(
      { condition: 'foo', text_true: 'yes', text_false: 'no' },
      ctx('conditional-text', { operator: 'equals', operand: 'foo' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('yes');
  });

  it('contains operator', async () => {
    const r = await node.taskHandler.execute(
      { condition: 'hello world', text_true: 'yes', text_false: 'no' },
      ctx('conditional-text', { operator: 'contains', operand: 'world' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('yes');
  });

  it('starts-with operator', async () => {
    const r = await node.taskHandler.execute(
      { condition: 'prefix_something', text_true: 'yes', text_false: 'no' },
      ctx('conditional-text', { operator: 'starts-with', operand: 'prefix_' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('yes');
  });

  it('ends-with operator', async () => {
    const r = await node.taskHandler.execute(
      { condition: 'something_suffix', text_true: 'yes', text_false: 'no' },
      ctx('conditional-text', { operator: 'ends-with', operand: '_suffix' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('yes');
  });

  it('returns error when condition input missing', async () => {
    const r = await node.taskHandler.execute({ text_true: 'A' }, ctx('conditional-text'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-count-lines ─────────────────────────────────────────────────────────

describe('TextCountLinesNodeDefinition', () => {
  const node = new TextCountLinesNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-count-lines');
    expect(node.category).toBe('Utility');
  });

  it('counts all lines including empty', async () => {
    const r = await node.taskHandler.execute({ text: 'a\n\nc' }, ctx('text-count-lines'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('3');
  });

  it('counts only non-empty lines when skipEmpty=true', async () => {
    const r = await node.taskHandler.execute(
      { text: 'a\n\nc' },
      ctx('text-count-lines', { skipEmpty: true }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('2');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-count-lines'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-repeat ──────────────────────────────────────────────────────────────

describe('TextRepeatNodeDefinition', () => {
  const node = new TextRepeatNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-repeat');
    expect(node.category).toBe('Utility');
  });

  it('repeats text N times with no separator', async () => {
    const r = await node.taskHandler.execute(
      { text: 'ab' },
      ctx('text-repeat', { times: 3, separator: '' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('ababab');
  });

  it('repeats with separator', async () => {
    const r = await node.taskHandler.execute(
      { text: 'x' },
      ctx('text-repeat', { times: 3, separator: '-' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('x-x-x');
  });

  it('returns empty string for times=0', async () => {
    const r = await node.taskHandler.execute({ text: 'x' }, ctx('text-repeat', { times: 0 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-repeat'));
    expect(r.ok).toBe(false);
  });
});

// ─── text-slice ───────────────────────────────────────────────────────────────

describe('TextSliceNodeDefinition', () => {
  const node = new TextSliceNodeDefinition();

  it('has correct metadata', () => {
    expect(node.nodeType).toBe('text-slice');
    expect(node.category).toBe('Utility');
  });

  it('slices from start to end', async () => {
    const r = await node.taskHandler.execute(
      { text: 'hello world' },
      ctx('text-slice', { start: 0, end: 5 }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('hello');
  });

  it('slices from index without end', async () => {
    const r = await node.taskHandler.execute(
      { text: 'hello world' },
      ctx('text-slice', { start: 6 }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('world');
  });

  it('negative start counts from end', async () => {
    const r = await node.taskHandler.execute(
      { text: 'hello world' },
      ctx('text-slice', { start: -5 }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('world');
  });

  it('returns error when text missing', async () => {
    const r = await node.taskHandler.execute({}, ctx('text-slice'));
    expect(r.ok).toBe(false);
  });
});
