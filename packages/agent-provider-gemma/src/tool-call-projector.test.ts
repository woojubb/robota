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
});
