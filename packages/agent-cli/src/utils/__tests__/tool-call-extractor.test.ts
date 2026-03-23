import { describe, it, expect } from 'vitest';
import { extractToolCalls, extractToolCallsWithDiff } from '../tool-call-extractor.js';

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

describe('extractToolCallsWithDiff', () => {
  it('non-Edit tool has no diffLines', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Read', arguments: '{"filePath":"/src/a.ts"}' } }],
      },
    ];
    const summaries = extractToolCallsWithDiff(history, 0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].line).toBe('Read(/src/a.ts)');
    expect(summaries[0].diffLines).toBeUndefined();
    expect(summaries[0].diffFile).toBeUndefined();
  });

  it('Edit tool includes diffLines and diffFile', () => {
    const args = JSON.stringify({
      file_path: '/src/index.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Edit', arguments: args } }],
      },
    ];
    const summaries = extractToolCallsWithDiff(history, 0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].diffFile).toBe('/src/index.ts');
    expect(summaries[0].diffLines).toEqual([
      { type: 'remove', text: 'const a = 1;' },
      { type: 'add', text: 'const a = 2;' },
    ]);
  });

  it('Edit tool with identical old/new has no diffLines', () => {
    const args = JSON.stringify({
      file_path: '/src/index.ts',
      old_string: 'same',
      new_string: 'same',
    });
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Edit', arguments: args } }],
      },
    ];
    const summaries = extractToolCallsWithDiff(history, 0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].diffLines).toBeUndefined();
    expect(summaries[0].diffFile).toBeUndefined();
  });

  it('multiple tools including Edit: only Edit has diff', () => {
    const editArgs = JSON.stringify({
      file_path: '/src/main.ts',
      old_string: 'foo',
      new_string: 'bar',
    });
    const history = [
      {
        role: 'assistant',
        toolCalls: [
          { function: { name: 'Read', arguments: '{"filePath":"/src/a.ts"}' } },
          { function: { name: 'Edit', arguments: editArgs } },
          { function: { name: 'Bash', arguments: '{"command":"ls"}' } },
        ],
      },
    ];
    const summaries = extractToolCallsWithDiff(history, 0);
    expect(summaries).toHaveLength(3);
    expect(summaries[0].diffLines).toBeUndefined();
    expect(summaries[1].diffLines).toBeDefined();
    expect(summaries[1].diffFile).toBe('/src/main.ts');
    expect(summaries[2].diffLines).toBeUndefined();
  });

  it('extractToolCalls (plain) returns string[] without diff info', () => {
    const editArgs = JSON.stringify({
      file_path: '/src/index.ts',
      old_string: 'a',
      new_string: 'b',
    });
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Edit', arguments: editArgs } }],
      },
    ];
    const result = extractToolCalls(history, 0);
    expect(result).toHaveLength(1);
    expect(typeof result[0]).toBe('string');
    // No diff properties on plain strings
    expect(result[0]).toContain('Edit(');
  });

  it('handles Edit tool with invalid JSON arguments gracefully', () => {
    const history = [
      {
        role: 'assistant',
        toolCalls: [{ function: { name: 'Edit', arguments: 'not json' } }],
      },
    ];
    const summaries = extractToolCallsWithDiff(history, 0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].diffLines).toBeUndefined();
  });
});
