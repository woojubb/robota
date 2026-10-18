import { describe, expect, it } from 'vitest';
import { GemmaReasoningProjector, projectGemmaReasoningText } from './index';
import koreanText from './__fixtures__/korean-text.json';

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
    const deltas = ['<|channel>', 's', '\n', '<channel|>', koreanText.trailingKoreanParticle];

    const visibleText =
      deltas.map((delta) => projector.project(delta)).join('') + projector.flush();

    expect(visibleText).toBe(koreanText.trailingKoreanParticle);
    expect(projector.rawText).toBe(`<|channel>s\n<channel|>${koreanText.trailingKoreanParticle}`);
    expect(projector.removedReasoning).toBe(true);
  });

  it('hands out the removed reasoning as it streams, across chunk boundaries', () => {
    const projector = new GemmaReasoningProjector();
    const chunks = ['<|cha', 'nnel>thou', 'ght\nI should ', 'check <chan', 'nel|>Visible'];

    const taken: string[] = [];
    const visible: string[] = [];
    for (const chunk of chunks) {
      visible.push(projector.project(chunk));
      taken.push(projector.takeReasoning());
    }
    visible.push(projector.flush());
    taken.push(projector.takeReasoning());

    expect(taken).toEqual(['', '', 'I should ', 'check ', '', '']);
    expect(visible.join('')).toBe('Visible');
    expect(projector.rawText).toBe('<|channel>thought\nI should check <channel|>Visible');
  });

  it('hands out each piece of reasoning once', () => {
    const projector = new GemmaReasoningProjector();

    projector.project('<|channel>thought\nfirst');

    expect(projector.takeReasoning()).toBe('first');
    expect(projector.takeReasoning()).toBe('');
  });

  it('hands out the reasoning of every channel in the reply, in order', () => {
    const projector = new GemmaReasoningProjector();

    projector.project('<|channel>thought\none<channel|>A<|channel>thought\ntwo<channel|>B');

    expect(projector.takeReasoning()).toBe('onetwo');
  });

  it('never reports a channel label or an empty channel as reasoning', () => {
    const labelOnly = new GemmaReasoningProjector();
    labelOnly.project('<|channel>thought\n<channel|>Final answer');
    const emptyMarkers = new GemmaReasoningProjector();
    emptyMarkers.project('<|channel>\n<channel|>thought\nFinal answer');
    const captured = new GemmaReasoningProjector();
    for (const delta of [
      '<|channel>',
      's',
      '\n',
      '<channel|>',
      koreanText.trailingKoreanParticle,
    ]) {
      captured.project(delta);
    }

    expect(labelOnly.takeReasoning()).toBe('');
    expect(emptyMarkers.takeReasoning()).toBe('');
    expect(captured.takeReasoning()).toBe('');
  });

  it('reports a held partial end marker once the stream is flushed', () => {
    const projector = new GemmaReasoningProjector();

    projector.project('<|channel>thought\nunfinished <chan');
    expect(projector.takeReasoning()).toBe('unfinished ');

    expect(projector.flush()).toBe('');
    expect(projector.takeReasoning()).toBe('<chan');
  });

  it('reports no reasoning for a reply without a thought channel', () => {
    const projector = new GemmaReasoningProjector();

    expect(projector.project('A thought about code')).toBe('A thought about code');
    expect(projector.takeReasoning()).toBe('');
  });

  it('preserves ordinary text that is not inside channel markers', () => {
    const projector = new GemmaReasoningProjector();

    expect(projector.project('A thought about code')).toBe('A thought about code');
    expect(projector.flush()).toBe('');
    expect(projector.removedReasoning).toBe(false);
  });
});
