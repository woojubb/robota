import { describe, expect, it } from 'vitest';
import { GemmaToolCallProjector, projectGemmaToolCallText } from './index';

describe('Gemma native tool-call projection', () => {
  it('projects documented LM Studio/Gemma tool-call blocks for declared tools', () => {
    const result = projectGemmaToolCallText(
      'before<|tool_call>call:DeclaredTool{prompt:<|"|>analyze<|"|>,background:true}<tool_call|>after',
      { toolNames: ['DeclaredTool'] },
    );

    expect(result.visibleText).toBe('beforeafter');
    expect(result.removedToolCallText).toBe(true);
    expect(result.rawToolCallText).toBe(
      '<|tool_call>call:DeclaredTool{prompt:<|"|>analyze<|"|>,background:true}<tool_call|>',
    );
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze","background":true}',
        },
      },
    ]);
  });

  it('keeps undeclared tool-call blocks visible and non-executable', () => {
    const raw = '<|tool_call>call:OtherTool{prompt:<|"|>analyze<|"|>}<tool_call|>';
    const result = projectGemmaToolCallText(raw, { toolNames: ['DeclaredTool'] });

    expect(result.visibleText).toBe(raw);
    expect(result.toolCalls).toEqual([]);
    expect(result.removedToolCallText).toBe(false);
  });

  it('holds split streamed tool-call blocks until complete', () => {
    const projector = new GemmaToolCallProjector({ toolNames: ['DeclaredTool'] });

    expect(projector.project('<|tool_call>call:Declar')).toMatchObject({
      visibleText: '',
      toolCalls: [],
      removedToolCallText: false,
    });
    const result = projector.project('edTool{prompt:<|"|>analyze<|"|>}<tool_call|>visible');

    expect(result.visibleText).toBe('visible');
    expect(result.removedToolCallText).toBe(true);
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze"}',
        },
      },
    ]);
    expect(projector.flush().visibleText).toBe('');
  });

  it('does not re-emit raw tool-call metadata after the block was projected', () => {
    const projector = new GemmaToolCallProjector({ toolNames: ['DeclaredTool'] });
    const first = projector.project(
      '<|tool_call>call:DeclaredTool{prompt:<|"|>analyze<|"|>}<tool_call|>',
    );
    const second = projector.project('visible');

    expect(first.rawToolCallText).toBe(
      '<|tool_call>call:DeclaredTool{prompt:<|"|>analyze<|"|>}<tool_call|>',
    );
    expect(second.visibleText).toBe('visible');
    expect(second.rawToolCallText).toBeUndefined();
    expect(second.removedToolCallText).toBe(false);
    expect(second.toolCalls).toEqual([]);
  });

  it('preserves malformed complete blocks instead of guessing execution', () => {
    const raw = '<|tool_call>call:DeclaredTool prompt:<|"|>missing braces<|"|><tool_call|>';
    const result = projectGemmaToolCallText(raw, { toolNames: ['DeclaredTool'] });

    expect(result.visibleText).toBe(raw);
    expect(result.toolCalls).toEqual([]);
    expect(result.removedToolCallText).toBe(false);
  });

  it('projects XML-like tags whose names match declared tools', () => {
    const result = projectGemmaToolCallText(
      'before<DeclaredTool prompt="analyze backlog" mode="plan" background="true" />after',
      { toolNames: ['DeclaredTool'] },
    );

    expect(result.visibleText).toBe('beforeafter');
    expect(result.removedToolCallText).toBe(true);
    expect(result.rawToolCallText).toBe(
      '<DeclaredTool prompt="analyze backlog" mode="plan" background="true" />',
    );
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze backlog","mode":"plan","background":true}',
        },
      },
    ]);
  });

  it('strips XML wrapper tags while projecting nested declared tool tags', () => {
    const result = projectGemmaToolCallText(
      [
        '<tool-launch-sequence>internal planning text</tool-launch-sequence>',
        '<tool-call-1>',
        '<DeclaredTool prompt="implementation analysis" mode="implementation" />',
        '</tool-call-1>',
        'visible',
      ].join(''),
      { toolNames: ['DeclaredTool'] },
    );

    expect(result.visibleText).toBe('visible');
    expect(result.rawToolCallText).toContain(
      '<DeclaredTool prompt="implementation analysis" mode="implementation" />',
    );
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"implementation analysis","mode":"implementation"}',
        },
      },
    ]);
  });

  it('projects JSON command envelopes for declared tools', () => {
    const result = projectGemmaToolCallText(
      [
        '<tool-call-1>',
        '{"command":"DeclaredTool","args":{"prompt":"analyze implementation","mode":"worker","background":true}}',
        '</tool-call-1>',
      ].join(''),
      { toolNames: ['DeclaredTool'] },
    );

    expect(result.visibleText).toBe('');
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze implementation","mode":"worker","background":true}',
        },
      },
    ]);
  });

  it('does not infer tool calls from wrapper text or command-like DSL', () => {
    const result = projectGemmaToolCallText(
      [
        '<tool-launch>',
        'parallel',
        ' worker=DeclaredTool:"Analyze implementation details."',
        ' reviewer=DeclaredTool:"Analyze architecture boundaries."',
        '</tool-launch>',
      ].join('\n'),
      { toolNames: ['DeclaredTool'] },
    );

    expect(result.visibleText).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.removedToolCallText).toBe(true);
  });

  it('does not infer slash-command text inside XML wrappers as tool calls', () => {
    const result = projectGemmaToolCallText(
      [
        '<tool-launch>',
        '/tool prompt:"Analyze concurrency." mode:"worker"',
        '/tool prompt:"Analyze UI flow." mode:"reviewer" background:true',
        '</tool-launch>',
      ].join('\n'),
      { toolNames: ['DeclaredTool'] },
    );

    expect(result.visibleText).toBe('');
    expect(result.toolCalls).toEqual([]);
  });

  it('strips generic XML wrapper tags without provider-specific tag names', () => {
    const result = projectGemmaToolCallText(
      '<execution-step>The task will be analyzed.</execution-step>visible',
      { toolNames: ['DeclaredTool'] },
    );

    expect(result.visibleText).toBe('visible');
    expect(result.toolCalls).toEqual([]);
    expect(result.removedToolCallText).toBe(true);
  });

  it('holds split streamed XML-like declared tool tags until complete', () => {
    const projector = new GemmaToolCallProjector({ toolNames: ['DeclaredTool'] });

    expect(projector.project('<DeclaredTool prompt="analyze')).toMatchObject({
      visibleText: '',
      toolCalls: [],
      removedToolCallText: false,
    });
    const result = projector.project(' backlog" mode="plan" />done');

    expect(result.visibleText).toBe('done');
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze backlog","mode":"plan"}',
        },
      },
    ]);
    expect(projector.flush().visibleText).toBe('');
  });
});
