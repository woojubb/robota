import { describe, expect, it } from 'vitest';
import { GemmaReasoningProjector, projectGemmaReasoningText } from './index';

describe('Gemma reasoning projection', () => {
  it('removes complete thought channel blocks from full text', () => {
    const result = projectGemmaReasoningText(
      'Hello <|channel>thought\nhidden reasoning<channel|>world',
    );

    expect(result.visibleText).toBe('Hello world');
    expect(result.removedReasoning).toBe(true);
    expect(result.rawText).toContain('hidden reasoning');
  });

  it('removes malformed empty thought markers emitted by local templates', () => {
    const result = projectGemmaReasoningText('<|channel>\n<channel|>thought\nFinal answer');

    expect(result.visibleText).toBe('Final answer');
    expect(result.removedReasoning).toBe(true);
  });

  it('handles reasoning markers split across streamed deltas', () => {
    const projector = new GemmaReasoningProjector();

    expect(projector.project('<|cha')).toBe('');
    expect(projector.project('nnel>thought\nhidden')).toBe('');
    expect(projector.project(' reasoning<channel|>Visible')).toBe('Visible');
    expect(projector.flush()).toBe('');
    expect(projector.rawText).toContain('hidden reasoning');
    expect(projector.removedReasoning).toBe(true);
  });

  it('removes captured local channel markers split across background streamed deltas', () => {
    const projector = new GemmaReasoningProjector();
    const deltas = ['<|channel>', 's', '\n', '<channel|>', '으로'];

    const visibleText =
      deltas.map((delta) => projector.project(delta)).join('') + projector.flush();

    expect(visibleText).toBe('으로');
    expect(projector.rawText).toBe('<|channel>s\n<channel|>으로');
    expect(projector.removedReasoning).toBe(true);
  });

  it('preserves ordinary text that is not inside channel markers', () => {
    const projector = new GemmaReasoningProjector();

    expect(projector.project('A thought about code')).toBe('A thought about code');
    expect(projector.flush()).toBe('');
    expect(projector.removedReasoning).toBe(false);
  });
});
