import { describe, it, expect } from 'vitest';
import { extractToolCalls } from '../tool-call-extractor.js';

describe('extractToolCalls', () => {
  it('returns empty array for empty history', () => {
    expect(extractToolCalls([], 0)).toEqual([]);
  });

  it('returns empty array when no assistant messages have toolCalls', () => {
    const history = [{ role: 'user' }, { role: 'assistant' }];
    expect(extractToolCalls(history, 0)).toEqual([]);
  });

  it('extracts tool call with string first argument', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Read', arguments: '{"filePath":"/src/index.ts"}' } }],
      },
    ];
    expect(extractToolCalls(history, 0)).toEqual(['Read(/src/index.ts)']);
  });

  it('extracts multiple tool calls from one message', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [
          { function: { name: 'Bash', arguments: '{"command":"ls -la"}' } },
          { function: { name: 'Glob', arguments: '{"pattern":"**/*.md"}' } },
        ],
      },
    ];
    expect(extractToolCalls(history, 0)).toEqual(['Bash(ls -la)', 'Glob(**/*.md)']);
  });

  it('extracts tool calls from multiple assistant messages', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Read', arguments: '{"filePath":"a.ts"}' } }],
      },
      { role: 'user' },
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Write', arguments: '{"filePath":"b.ts"}' } }],
      },
    ];
    expect(extractToolCalls(history, 0)).toEqual(['Read(a.ts)', 'Write(b.ts)']);
  });

  it('skips messages before startIndex', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Old', arguments: '{"x":"skip"}' } }],
      },
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'New', arguments: '{"x":"keep"}' } }],
      },
    ];
    expect(extractToolCalls(history, 1)).toEqual(['New(keep)']);
  });

  it('truncates long argument values with middle ellipsis', () => {
    const longPath =
      '/Users/jungyoun/Documents/dev/robota/packages/agent-sdk/src/plugins/very-long-directory-name/file.ts';
    const history = [
      {
        role: 'assistant',
        toolCalls: [
          { function: { name: 'Read', arguments: JSON.stringify({ filePath: longPath }) } },
        ],
      },
    ];
    const result = extractToolCalls(history, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('...');
    // Should keep the tail (file name visible)
    expect(result[0]).toContain('file.ts');
    // Total display length should be reasonable
    expect(result[0].length).toBeLessThanOrEqual(90);
  });

  it('handles non-string first argument (JSON stringified)', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Tool', arguments: '{"count":42}' } }],
      },
    ];
    expect(extractToolCalls(history, 0)).toEqual(['Tool(42)']);
  });

  it('handles invalid JSON arguments gracefully', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Tool', arguments: 'not json' } }],
      },
    ];
    expect(extractToolCalls(history, 0)).toEqual(['Tool(not json)']);
  });

  it('skips non-assistant messages', () => {
    const history = [
      { role: 'user' },
      { role: 'system' },
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Bash', arguments: '{"command":"echo hi"}' } }],
      },
    ];
    expect(extractToolCalls(history, 0)).toEqual(['Bash(echo hi)']);
  });
});
